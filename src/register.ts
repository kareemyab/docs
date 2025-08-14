import { Request, Response } from 'express';
import { PublicKey, SystemProgram, ComputeBudgetProgram } from '@solana/web3.js';
import BN from 'bn.js';

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
            fileMetadata
        } = req.body;
        

        if (!contentHashHex) {
            const status = 400;
            const message = 'Missing `contentHash` or `fileMetadata`. These are now required.';
            return res.status(status).json({ error: true, message });
        }

        if (!contentTitle || !walletAddress || !walletType) {
            const status = 400;
            const message = "Hold on! We need `contentTitle`, `walletAddress`, and `walletType` to proceed.";
            const details = {
                missingFields: [
                    ...(!contentTitle ? ['contentTitle'] : []),
                    ...(!walletAddress ? ['walletAddress'] : []),
                    ...(!walletType ? ['walletType'] : [])
                ]
            };
            return res.status(status).json({ error: true, message, details });
        }

        if (walletType !== 'standard' && walletType !== 'crossmint') {
            const status = 400;
            const message = "Invalid `walletType`. It must be either 'standard' or 'crossmint'.";
            return res.status(status).json({ error: true, message });
        }

        let claimHashBytes = Buffer.alloc(32); // Default to 32 zero bytes

        if (claimHash) {
            if (typeof claimHash !== 'string' || !/^[a-fA-F0-9]{64}$/.test(claimHash)) {
                const status = 400;
                const message = 'Invalid `claimHash`. It must be a 32-byte hex string (64 characters).';
                return res.status(status).json({ error: true, message });
            }
            claimHashBytes = Buffer.from(claimHash, 'hex');
            logger.info('   - Claim Hash provided:', claimHash);
        } else {
            logger.info('   - No Claim Hash provided, using default.');
        }

        const contentHash = Buffer.from(contentHashHex, 'hex');
        logger.info('   - Content Hash (SHA256):', contentHashHex);

        const [contentRegistrationPda] = PublicKey.findProgramAddressSync(
            [Buffer.from('content_registration'), new PublicKey(walletAddress).toBuffer(), contentHash],
            dependencies.zkp_program.programId
        );

        try {
            await dependencies.zkp_program.account.contentRegistration.fetch(contentRegistrationPda);
            
            logger.warn(`⚠️  Conflict: An account for this content hash already exists at PDA ${contentRegistrationPda.toString()}`);
            
            const status = 409;
            const message = 'Looks like you have already registered this file. Please use the /search endpoint to find the existing record.';
            const details = {
                contentHash: contentHashHex,
                pdaAddress: contentRegistrationPda.toString(),
                'Suggestion': 'Use the /search endpoint to find the existing record.'
            };
            return res.status(status).json({ error: true, message, details });

        } catch (error) {
            logger.info('✅ No existing account found. Proceeding with new registration.');
        }

        logger.info('🔗 Checking if wallet has a user-key relation...');
        const walletPublicKey = new PublicKey(walletAddress);
        
        try {
            const [walletToUserIdRelationPDA] = PublicKey.findProgramAddressSync(
                [Buffer.from("wallet_to_user_id"), walletPublicKey.toBuffer()], 
                dependencies.user_key_relations_program.programId
            );

            const userKeyRelation = await dependencies.user_key_relations_program.account.userKeyRelation.fetch(walletToUserIdRelationPDA);
            logger.info('✅ User-key relation found. Proceeding with registration.');
            logger.info(`   - User ID: ${userKeyRelation.userId}`);
            logger.info(`   - Wallet: ${userKeyRelation.userPublicKey.toString()}`);
        } catch (userKeyError) {
            logger.warn('❌ No user-key relation found for this wallet address.');
            
            const status = 400;
            const message = "This wallet address doesn't have a user ID relation. Please create one first.";
            const details = {
                'Missing Requirement': 'User-Key Relation',
                'Wallet Address': walletAddress,
                'Suggestion': 'Use the /link-wallet endpoint to link your wallet to a user ID first',
                'Alternative': 'Use the /create-wallet endpoint to create a new wallet with automatic user ID linking',
                'Find Existing': 'Use the /find-wallet endpoint to check if a relation already exists'
            };
            
            return res.status(status).json({ error: true, message, details });
        }

        logger.info("📝 Received registration request with:");
        logger.info("   - Title:", contentTitle);
        logger.info("   - Wallet Address:", walletAddress);

        let publicMetadata: any = {};

        if (metadata) {
            if (typeof metadata !== 'string') {
                const status = 400;
                const message = "The provided metadata is not a string. Please check the format.";
                return res.status(status).json({ error: true, message });
            }
            if (metadata.length > 500) {
                const status = 400;
                const message = "Metadata is too long. A maximum of 500 characters is allowed.";
                return res.status(status).json({ error: true, message });
            }
            publicMetadata = metadata;
            logger.info("   - Public metadata:", publicMetadata);
        } else {
            logger.info("📋 No metadata provided.");
            publicMetadata = "";
        }

        logger.info("🔍 Public metadata:", publicMetadata);

        // File metadata is now passed directly in the request body
        logger.info(`Processing file: ${fileMetadata.fileName} (${fileMetadata.fileSize} bytes, ${fileMetadata.mimeType})`);

        logger.info('📦 Preparing and uploading data to QuickNode IPFS via FormData...');

        const combinedMetadata = {
            public_metadata: publicMetadata,
            file_metadata: { ...fileMetadata, contentTitle },
            content_hash: contentHash.toString('hex')
        };

        let rootCid = '';
        try {
            logger.info('🚀 Uploading combined metadata to QuickNode IPFS...');
            
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

            logger.info('🔍 QuickNode IPFS upload result:', quicknodeResult);
            
            if (!quicknodeResult.pin || !quicknodeResult.pin.cid) {
                const status = 500;
                const message = 'Invalid response from QuickNode IPFS - missing CID';
                return res.status(status).json({ error: true, message });
            }

            rootCid = quicknodeResult.pin.cid;
            logger.info(`✅ QuickNode IPFS upload successful! CID: ${rootCid}`);
            logger.info(`   - Uploaded combined metadata with key: ${fileName}`);
            
        } catch (ipfsError: any) {
            logger.error('💥 QuickNode IPFS upload failed:', ipfsError.message);
            const status = 500;
            const message = 'Failed to upload data to QuickNode IPFS. Please check your API key and try again.';
            return res.status(status).json({ error: true, message });
        }
        
        logger.info("✅ Content hashed and uploaded to IPFS. Submitting to the blockchain for verification...");
        
        const userWallet = new PublicKey(walletAddress);

        logger.info(`   - User Wallet: ${userWallet.toBase58()}`);
        logger.info(`   - Content Registration PDA: ${contentRegistrationPda.toBase58()}`);

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
            logger.info('🔐 Submitting transaction via Crossmint...');
            const { signature: crossmintTxId } = await dependencies.submitTransaction(transaction, walletAddress, dependencies.connection);

            const status = 202;
            const message = "✅ Accepted! Your file has been submitted and is being processed by Crossmint.";
            const jsonDetails = {
                status: 'processing',
                crossmintTransactionId: crossmintTxId,
                contentRegistrationPDA: contentRegistrationPda.toBase58(),
                contentHash: contentHashHex,
                ipfsCid: rootCid,
            };

            return res.status(status).json({ message, details: jsonDetails });

        } else {
            logger.info('✅ Transaction constructed. Preparing for client-side signing...');

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

            const status = 200;
            const message = "Transaction prepared. Please sign and submit via your wallet.";
            const details = {
                status: 'requires-client-signature',
                transaction: serializedTransaction.toString('base64'),
                ipfsCid: rootCid,
                contentRegistrationPDA: contentRegistrationPda.toBase58(),
                contentHash: contentHashHex
            };
            
            return res.status(status).json({ message, details });
        }

    } catch (error: any) {
        logger.error('💥 An error occurred during registration:', error.message || error);
        const status = 500;
        const message = "We have a problem! Something went wrong on our end. Our team has been notified.";
        return res.status(status).json({ error: true, message, details: { error: error.message } });
    }
  };
};
