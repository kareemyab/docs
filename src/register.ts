import { Request, Response } from 'express';
import { PublicKey, SystemProgram, ComputeBudgetProgram } from '@solana/web3.js';
import BN from 'bn.js';
import { generateSecureToken, insertTransactionAction } from './database';

export const registerHandler = (dependencies: any) => {
  return async (req: Request, res: Response) => {
    const { logger } = dependencies;
    try {
        const {
            contentTitle,
            walletAddress,
            metadata,
            walletType,
            claimHash,
            contentHash: contentHashHex,
            fileMetadata,
            returnActionLink
        } = req.body;

        // input validation
        const validation = dependencies.validateFields({ contentHashHex, contentTitle, walletAddress, walletType });
        const errors = [];

        if (validation.missing.length > 0 ) {
            errors.push({ type: 'missing_fields', fields: validation.missing, message: 'Missing input fields' });
        }

        if (validation.invalidTypes.length > 0) {
            errors.push({ type: 'invalid_types', fields: validation.invalidTypes, message: 'Invalid input types. Must be a string' });
        }

        if (walletType !== 'standard' && walletType !== 'crossmint') {
            errors.push({
                type: 'invalid_value',
                field: 'walletType',
                message: 'Must be standard or crossmint'
            })
        }

        if (returnActionLink !== undefined && typeof returnActionLink !== 'boolean') {
            errors.push({
                type: 'invalid_type',
                field: 'returnActionLink',
                message: 'Must be a boolean value'
            });
        }

        let claimHashBytes = Buffer.alloc(32); // Default to 32 zero bytes

        if (claimHash) {
            if (typeof claimHash !== 'string' || !/^[a-fA-F0-9]{64}$/.test(claimHash)) {
               errors.push({
                type: 'invalid_format',
                field: 'claimHash',
                message: 'Must be a 32-byte hex string (64 characters)'
               })
            }
            claimHashBytes = Buffer.from(claimHash, 'hex');
        }

        if (metadata) {
            if (typeof metadata !== 'string') {
                errors.push({
                    type: 'invalid_types',
                    field: 'metadata',
                    message: 'Must be a string'
                })
            }
            if (metadata.length > 500) {
                errors.push({
                    type: 'invalid_value',
                    field: 'metadata',
                    message: 'Metadata is too long. A maximum of 500 characters is allowed.'
                })
            }
        }

        if (walletAddress.length > 1000) {
            logger.warn('Suspiciously long wallet address', {
                ip: req.ip,
                length: walletAddress.length,
            })
            errors.push({
                type: 'invalid_value',
                field: 'walletAddress',
                message: 'Wallet address is too long. A maximum of 1000 characters is allowed.'
            })
        }

        if (errors.length > 0) {
            const status = 400;
            const message = 'Input validation failed';
            const details = {
                validationErrors: errors
            }
            return res.status(status).json({ error: true, message, details });
        }

        // check if file is registered
        const contentHash = Buffer.from(contentHashHex, 'hex');

        const [contentRegistrationPda] = PublicKey.findProgramAddressSync(
            [Buffer.from('content_registration'), new PublicKey(walletAddress).toBuffer(), contentHash],
            dependencies.zkp_program.programId
        );

        try {
            await dependencies.zkp_program.account.contentRegistration.fetch(contentRegistrationPda);

            const status = 409;
            const message = 'Looks like you have already registered this file. Please use the /search endpoint to find the existing record.';
            const details = {
                contentHash: contentHashHex,
                pdaAddress: contentRegistrationPda.toString(),
                suggestion: 'Use the /search endpoint to find the existing record.'
            };
            return res.status(status).json({ error: true, message, details });

        } catch (error: any) {}

        // check if wallet has a user id
        const walletPublicKey = new PublicKey(walletAddress);
        
        try {
            const [walletToUserIdRelationPDA] = PublicKey.findProgramAddressSync(
                [Buffer.from("wallet_to_user_id"), walletPublicKey.toBuffer()], 
                dependencies.user_key_relations_program.programId
            );

            await dependencies.user_key_relations_program.account.userKeyRelation.fetch(walletToUserIdRelationPDA);
        } catch (userKeyError) {            
            const status = 409;
            const message = "This wallet address doesn't have a user ID relation. Please create one first.";
            const details = {
                missingRequirement: 'User-Key Relation',
                walletAddress: walletAddress,
                suggestion: 'Use the /link-wallet endpoint to link your wallet to a user ID first',
                alternative: 'Use the /create-wallet endpoint to create a new wallet with automatic user ID linking',
                findExisting: 'Use the /find-wallet endpoint to check if a relation already exists'
            };
            
            return res.status(status).json({ error: true, message, details });
        }

        const combinedMetadata = {
            public_metadata: metadata,
            file_metadata: { ...fileMetadata, contentTitle },
            content_hash: contentHash.toString('hex')
        };

        let rootCid = '';
        try {            
            const myHeaders = new Headers();
            myHeaders.append("x-api-key", dependencies.QUICKNODE_API_KEY);

            const formdata = new FormData();
            const metadataString = JSON.stringify(combinedMetadata, null, 2);
            const metadataBlob = new Blob([metadataString], { type: 'application/json' });
            const fileName = `combined-metadata-${contentHash.toString('hex')}-${Date.now()}.json`;

            formdata.append("Body", metadataBlob, fileName);
            formdata.append("Key", fileName);
            formdata.append("ContentType", "application/json");
            
            const requestOptions = {
                method: 'POST',
                headers: myHeaders,
                body: formdata,
            };

            const quicknodeResponse = await fetch("https://api.quicknode.com/ipfs/rest/v1/s3/put-object", requestOptions);

            if (!quicknodeResponse.ok) {
                const errorText = await quicknodeResponse.text();
                const status = quicknodeResponse.status;
                const message = `QuickNode IPFS upload failed: ${status} - ${errorText}`;
                return res.status(status).json({ error: true, message });
            }

            const quicknodeResult = await quicknodeResponse.json() as any;
            
            if (!quicknodeResult.pin || !quicknodeResult.pin.cid) {
                const status = 500;
                const message = 'Invalid response from QuickNode IPFS - missing CID';
                return res.status(status).json({ error: true, message });
            }

            rootCid = quicknodeResult.pin.cid;
            
        } catch (ipfsError: any) {
            logger.error('💥 QuickNode IPFS upload failed:', ipfsError.message);
            const status = 500;
            const message = 'Failed to upload data to QuickNode IPFS. Please check your API key and try again.';
            return res.status(status).json({ error: true, message });
        }
                
        const userWallet = new PublicKey(walletAddress);

        const transaction = await dependencies.zkp_program.methods
            .submitRegistration(
                Array.from(contentHash),
                Array.from(claimHashBytes),
                rootCid,
                new BN(Math.floor(Date.now() / 1000))
            )
            .accounts({
                creator: userWallet,
                rentPayer: dependencies.feePayer.publicKey,
                contentRegistration: contentRegistrationPda,
                systemProgram: SystemProgram.programId,
            } as any)
            .transaction();

        if (walletType === 'crossmint') {
            const result = await dependencies.submitTransaction(transaction, walletAddress, dependencies.connection);

            if (result.error) {
                const status = 500;
                const message = result.error;
                return res.status(status).json({ error: true, message });
            }

            const status = 200;
            const message = "✅ Success! Your file has been registered and confirmed on-chain.";
            const jsonDetails = {
                status: 'confirmed',
                transactionSignature: result.signature,
                contentRegistrationPDA: contentRegistrationPda.toBase58(),
                contentHash: contentHashHex,
                ipfsCid: rootCid,
                explorerUrl: `https://explorer.solana.com/tx/${contentRegistrationPda.toBase58()}?cluster=devnet`
            };

            return res.status(status).json({ message, details: jsonDetails });

        } else {
            const { blockhash } = await dependencies.connection.getLatestBlockhash('confirmed');
            transaction.recentBlockhash = blockhash;
            transaction.feePayer = dependencies.feePayer.publicKey;

            transaction.add(
                ComputeBudgetProgram.setComputeUnitPrice({
                    microLamports: 1000,
                })
            );

            const serializedTransaction = transaction.serialize({
                requireAllSignatures: false,
            });

            // If returnActionLink is true, create database entry and return action link
            if (returnActionLink === true) {
                try {
                    const token = generateSecureToken();
                    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now

                    await insertTransactionAction({
                        token,
                        unsigned_transaction: serializedTransaction.toString('base64'),
                        creator_pubkey: walletAddress,
                        content_hash: contentHashHex,
                        content_title: contentTitle,
                        expires_at: expiresAt
                    });

                    const actionLink = `http://trustengine.org/tx-action/${token}`;
                    
                    const status = 200;
                    const message = "Transaction prepared and action link created. Use the link to sign the transaction.";
                    const details = {
                        status: 'action-link-created',
                        actionLink: actionLink,
                        token: token,
                        expiresAt: expiresAt.toISOString(),
                        contentHash: contentHashHex
                    };
                    
                    return res.status(status).json({ message, details });
                    
                } catch (dbError: any) {
                    logger.error('💥 Failed to create action link:', dbError.message);
                    const status = 500;
                    const message = 'Failed to create action link. Please try again.';
                    return res.status(status).json({ error: true, message });
                }
            } else {
                // Original behavior - return transaction for immediate signing
                const status = 200;
                const message = "Transaction prepared and pre-signed. Please sign and submit via your wallet.";
                const details = {
                    status: 'requires-client-signature',
                    transaction: serializedTransaction.toString('base64'),
                    ipfsCid: rootCid,
                    contentRegistrationPDA: contentRegistrationPda.toBase58(),
                    contentHash: contentHashHex
                };
                
                return res.status(status).json({ message, details });
            }
        }

    } catch (error: any) {
        logger.error('💥 An error occurred during registration:', error.message || error);
        const status = 500;
        const message = "We have a problem! Something went wrong on our end. Our team has been notified.";
        return res.status(status).json({ error: true, message, details: { error: error.message } });
    }
  };
};
