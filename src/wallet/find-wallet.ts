import { Request, Response } from 'express';
import { PublicKey } from '@solana/web3.js';

export const findWalletHandler = (dependencies: any) => {
    return async (req: Request, res: Response) => {
        const { logger } = dependencies;        
        try {
            const { userID, walletAddress } = req.query;

            // Validate that exactly one parameter is provided
            if ((!userID && !walletAddress) || (userID && walletAddress)) {
                const status = 400;
                const message = "Please provide either a `userID` OR a `walletAddress` query parameter, but not both.";
                const details = {
                    provided: {
                        userID: userID ? 'provided' : 'not provided',
                        walletAddress: walletAddress ? 'provided' : 'not provided'
                    },
                    requirement: 'Exactly one of userID or walletAddress must be provided',
                    examples: [
                        'GET /find-wallet?userID=user123',
                        'GET /find-wallet?walletAddress=9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
                    ]
                };
                
                return res.status(status).json({ error: true, message, details });
            }

            logger.info('🔍 Finding wallet relation...');
            
            let relationPDA: PublicKey;
            let searchType: string;
            let searchValue: string;
            
            if (userID) {
                // Search by user ID - use "user_id_to_wallet" seed
                searchType = 'userID';
                searchValue = userID as string;
                logger.info('   - Searching by User ID:', userID);
                
                [relationPDA] = PublicKey.findProgramAddressSync(
                    [Buffer.from("user_id_to_wallet"), Buffer.from(userID as string)],
                    dependencies.user_key_relations_program.programId
                );
            } else {
                // Search by wallet address - use "wallet_to_user_id" seed
                searchType = 'walletAddress';
                searchValue = walletAddress as string;
                logger.info('   - Searching by Wallet Address:', walletAddress);
                
                try {
                    const publicKey = new PublicKey(walletAddress as string);
                    [relationPDA] = PublicKey.findProgramAddressSync(
                        [Buffer.from("wallet_to_user_id"), publicKey.toBuffer()],
                        dependencies.user_key_relations_program.programId
                    );
                } catch (error) {
                    const status = 400;
                    const message = "Invalid wallet address format.";
                    const details = {
                        walletAddress,
                        error: 'Not a valid Solana public key',
                        example: 'GET /find-wallet?walletAddress=9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
                    };
                    
                    return res.status(status).json({ error: true, message, details });
                }
            }

            // Fetch the relation account
            try {
                const relation = await dependencies.user_key_relations_program.account.userKeyRelation.fetch(relationPDA);
                
                logger.info('✅ Relation found:', {
                    userId: relation.userId,
                    userPublicKey: relation.userPublicKey.toString(),
                    createdAt: new Date(relation.createdAt.toNumber() * 1000).toISOString()
                });

                const status = 200;
                const message = `Wallet relation found successfully using ${searchType}.`;
                const details = {
                    searchType,
                    searchValue,
                    relation: {
                        userId: relation.userId,
                        walletAddress: relation.userPublicKey.toString(),
                        createdAt: new Date(relation.createdAt.toNumber() * 1000).toISOString(),
                        relationPDA: relationPDA.toString()
                    }
                };

                return res.status(status).json({ 
                    success: true, 
                    message, 
                    details
                });

            } catch (error) {
                logger.warn(`❌ No relation found for ${searchType}: ${searchValue}`);
                
                const status = 404;
                const message = `No wallet relation found for the provided ${searchType}.`;
                const details = {
                    searchType,
                    searchValue,
                    suggestion: searchType === 'userID' 
                        ? 'Try using the wallet address instead, or create a new relation using /link-wallet'
                        : 'Try using the user ID instead, or create a new relation using /link-wallet'
                };

                return res.status(status).json({ error: true, message, details });
            }

        } catch (error) {
            logger.error('❌ Error in find wallet handler:', error);
            
            const status = 500;
            const message = "An unexpected error occurred while searching for the wallet relation.";
            const details = {
                error: error instanceof Error ? error.message : 'Unknown error'
            };

            return res.status(status).json({ error: true, message, details });
        }
    };
};
