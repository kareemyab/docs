import { Request, Response } from 'express';
import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';

export const searchHandler = (dependencies: any) => {
    return async (req: Request, res: Response) => {
        const { logger } = dependencies;
        try {
            const { contentHash: contentHashHex, walletAddress } = req.body;

            if (!contentHashHex) {
                const status = 400;
                const message = 'Oops! You need to provide a `contentHash` to search for a file.';
                return res.status(status).json({ error: true, message });
            }

            // Validate wallet address if provided
            if (walletAddress) {
                try {
                    new PublicKey(walletAddress);
                } catch (walletError) {
                    const status = 400;
                    const message = 'Invalid wallet address format. Please provide a valid Solana public key.';
                    return res.status(status).json({ error: true, message });
                }
            }

            const searchMode = walletAddress ? 'content_hash_and_wallet' : 'content_hash_only';
            logger.info(`🔎 Search mode: ${searchMode}`);
            logger.info(`   - Content hash: ${contentHashHex}`);
            if (walletAddress) {
                logger.info(`   - Wallet address: ${walletAddress}`);
            }

            const contentHash = Buffer.from(contentHashHex, 'hex');

            try {
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
                        logger.info(`✅ Found specific registration for content hash and wallet address.`);
                    } catch (fetchError) {
                        matchingRegistrations = [];
                        logger.info(`   - No registration found for this content hash and wallet address combination.`);
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
                    logger.info(`✅ Found ${matchingRegistrations.length} total registration(s) for this content hash.`);
                }

                if (matchingRegistrations.length === 0) {
                    const status = 404;
                    let message, details;
                    
                    if (searchMode === 'content_hash_and_wallet') {
                        message = "No registration found for this content hash and wallet address combination.";
                        details = { 
                            'Searched Content Hash': contentHash.toString('hex'),
                            'Searched Wallet Address': walletAddress,
                            'Search Mode': 'Specific Registration'
                        };
                    } else {
                        message = "An on-chain proof for this file does not exist, which means it has not been registered.";
                        details = { 
                            'Searched Content Hash': contentHash.toString('hex'),
                            'Search Mode': 'All Registrations'
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
                        'Content Hash': contentHash.toString('hex'),
                        'PDA Address': pdaAddress,
                        'IPFS CID': reg.account.ipfsCid,
                        'Registered by': reg.account.creator.toString(),
                        ...(userID && { 'User ID': userID }),
                        'Timestamp': new Date(reg.account.timestamp.toNumber() * 1000).toISOString(),
                        'Validation Status': reg.account.finalized ? 'Verified' : 'Pending Verification',
                        'Consensus': reg.account.finalized ? `${reg.account.consensusPercentage}%` : 'Pending',
                        'Solana Explorer': `https://explorer.solana.com/address/${pdaAddress}?${dependencies.EXPLORER_CLUSTER_PARAM}`,
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
                        contentHash: cliFriendly['Content Hash'],
                        pdaAddress: cliFriendly['PDA Address'],
                        ipfsCid: cliFriendly['IPFS CID'],
                        registeredBy: cliFriendly['Registered by'],
                        userID: cliFriendly['User ID'] || null,
                        timestamp: cliFriendly['Timestamp'],
                        validationStatus: cliFriendly['Validation Status'],
                        consensus: cliFriendly['Consensus'],
                        explorerUrl: cliFriendly['Solana Explorer'],
                        onChainData: matchingRegistrations.find(reg => reg.publicKey.toString() === cliFriendly['PDA Address'])?.account
                    }))
                });

            } catch (accountError: any) {
                logger.error(`   - Error fetching registrations: ${accountError.message}`);
                const status = 500;
                const message = "An error occurred while searching for registrations.";
                return res.status(status).json({ error: true, message, details: { error: accountError.message } });
            }

        } catch (error: any) {
            logger.error('💥 Search error:', error.message || error);
            const status = 500;
            const message = "Oh no! Something went wrong during the search. Our team is on it!";
            return res.status(status).json({ error: true, message, details: { error: error.message } });
        }
    };
};
