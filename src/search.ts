import { Request, Response } from 'express';
import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';

export const searchHandler = (dependencies: any) => {
    return async (req: Request, res: Response) => {
        const { logger } = dependencies;
        try {
            const { contentHash: contentHashHex, walletAddress } = req.body;

            // Input validation using the helper function for required fields
            const validation = dependencies.validateFields({ contentHash: contentHashHex });
            const errors = [];

            if (validation.missing.length > 0) {
                errors.push({ type: 'missing_fields', fields: validation.missing, message: 'Missing input fields' });
            }

            if (validation.invalidTypes.length > 0) {
                errors.push({ type: 'invalid_types', fields: validation.invalidTypes, message: 'Invalid input types. Must be a string' });
            }

            // Additional validation for content hash format
            if (contentHashHex && !/^[a-fA-F0-9]{64}$/.test(contentHashHex)) {
                errors.push({
                    type: 'invalid_format',
                    field: 'contentHash',
                    message: 'Must be a 32-byte hex string (64 characters)'
                });
            }

            // Validate wallet address if provided (optional field)
            if (walletAddress) {
                if (typeof walletAddress !== 'string') {
                    errors.push({
                        type: 'invalid_types',
                        field: 'walletAddress',
                        message: 'Must be a string'
                    });
                } else {
                    try {
                        new PublicKey(walletAddress);
                    } catch (walletError) {
                        errors.push({
                            type: 'invalid_format',
                            field: 'walletAddress',
                            message: 'Invalid wallet address format. Must be a valid Solana public key.'
                        });
                    }
                }
            }

            if (errors.length > 0) {
                const status = 400;
                const message = 'Input validation failed';
                const details = {
                    validationErrors: errors
                };
                return res.status(status).json({ error: true, message, details });
            }

            const searchMode = walletAddress ? 'content_hash_and_wallet' : 'content_hash_only';

            const contentHash = Buffer.from(contentHashHex, 'hex');

            let matchingRegistrations;

            if (searchMode === 'content_hash_and_wallet') {
                // Search for specific registration by content hash and wallet address
                const walletPubkey = new PublicKey(walletAddress);
                const [contentRegistrationPda] = PublicKey.findProgramAddressSync(
                    [Buffer.from('content_registration'), walletPubkey.toBuffer(), contentHash],
                    dependencies.zkp_program.programId
                );

                try {
                    const specificRegistration = await dependencies.zkp_program.account.contentRegistration.fetch(contentRegistrationPda);
                    matchingRegistrations = [{
                        publicKey: contentRegistrationPda,
                        account: specificRegistration
                    }];
                } catch (fetchError) {
                    matchingRegistrations = [];
                }
            } else {
                // Search for all registrations by content hash only
                matchingRegistrations = await dependencies.zkp_program.account.contentRegistration.all([
                    {
                        memcmp: {
                            offset: 8, // 8-byte anchor discriminator.
                            bytes: bs58.encode(contentHash),
                        }
                    }
                ]);
            }

            if (matchingRegistrations.length === 0) {
                const status = 409;
                let message, details;
                
                if (searchMode === 'content_hash_and_wallet') {
                    message = "No registration found for this content hash and wallet address combination.";
                    details = { 
                        searchedContentHash: contentHash.toString('hex'),
                        searchedWalletAddress: walletAddress,
                        searchMode: 'Specific Registration'
                    };
                } else {
                    message = "An on-chain proof for this file does not exist, which means it has not been registered.";
                    details = { 
                        searchedContentHash: contentHash.toString('hex'),
                        searchMode: 'All Registrations'
                    };
                }
                
                return res.status(status).json({ error: true, message, details });
            }

            const results = await Promise.all(matchingRegistrations.map(async (reg) => {
                let userID = null;
                try {
                    const [userKeyRelationPDA] = PublicKey.findProgramAddressSync(
                        [Buffer.from("user_key_relation"), reg.account.creator.toBuffer()], 
                        dependencies.user_key_relations_program.programId
                    );
                    const userKeyRelation = await dependencies.user_key_relations_program.account.userKeyRelation.fetch(userKeyRelationPDA);
                    userID = userKeyRelation.userId;
                } catch (userKeyError) {
                    // Not an error, just means no relation found
                }

                const pdaAddress = reg.publicKey.toString();

                return {
                    contentHash: contentHash.toString('hex'),
                    pdaAddress: pdaAddress,
                    ipfsCid: reg.account.ipfsCid,
                    registeredBy: reg.account.creator.toString(),
                    ...(userID && { userID }),
                    timestamp: new Date(reg.account.timestamp.toNumber() * 1000).toISOString(),
                    validationStatus: reg.account.finalized ? 'Verified' : 'Pending Verification',
                    consensus: reg.account.finalized ? `${reg.account.consensusPercentage}%` : 'Pending',
                    explorerUrl: `https://explorer.solana.com/address/${pdaAddress}?${dependencies.EXPLORER_CLUSTER_PARAM}`,
                };
            }));

            const status = 200;
            let message;
            
            if (searchMode === 'content_hash_and_wallet') {
                message = `Found the specific registration for this content hash and wallet address.`;
            } else {
                message = `Found ${results.length} registration(s) for this content hash.`;
            }
            
            return res.status(status).json({
                searchMode,
                message,
                searchCriteria: {
                    contentHash: contentHash.toString('hex'),
                    ...(walletAddress && { walletAddress })
                },
                totalResults: results.length,
                registrations: results.map(cliFriendly => ({
                    contentHash: cliFriendly.contentHash,
                    pdaAddress: cliFriendly.pdaAddress,
                    ipfsCid: cliFriendly.ipfsCid,
                    registeredBy: cliFriendly.registeredBy,
                    userID: cliFriendly.userID || null,
                    timestamp: cliFriendly.timestamp,
                    validationStatus: cliFriendly.validationStatus,
                    consensus: cliFriendly.consensus,
                    explorerUrl: cliFriendly.explorerUrl,
                    onChainData: matchingRegistrations.find(reg => reg.publicKey.toString() === cliFriendly.pdaAddress)?.account
                }))
            });

        } catch (error: any) {
            logger.error('💥 Search error:', error.message || error);
            const status = 500;
            const message = "We have a problem! Something went wrong on our end. Our team has been notified.";
            return res.status(status).json({ error: true, message, details: { error: error.message } });
        }
    };
};
