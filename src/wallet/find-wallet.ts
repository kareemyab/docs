import { Request, Response } from 'express';
import { PublicKey } from '@solana/web3.js';

export const findWalletHandler = (dependencies: any) => {
    return async (req: Request, res: Response) => {
        const { logger } = dependencies;        
        try {
            const { userID, walletAddress } = req.query;

            // Input validation for query parameters
            const errors = [];
            
            // Validate that exactly one parameter is provided
            if ((!userID && !walletAddress) || (userID && walletAddress)) {
                errors.push({
                    type: 'invalid_parameters',
                    message: 'Exactly one of userID or walletAddress must be provided'
                });
            }

            // Type validation for provided parameters
            if (userID && typeof userID !== 'string') {
                errors.push({
                    type: 'invalid_types',
                    field: 'userID',
                    message: 'Must be a string'
                });
            }

            if (walletAddress && typeof walletAddress !== 'string') {
                errors.push({
                    type: 'invalid_types',
                    field: 'walletAddress',
                    message: 'Must be a string'
                });
            }

            if (errors.length > 0) {
                const status = 400;
                const message = 'Input validation failed';
                const details = {
                    validationErrors: errors,
                    provided: {
                        userID: userID ? 'provided' : 'not provided',
                        walletAddress: walletAddress ? 'provided' : 'not provided'
                    },
                    examples: [
                        'GET /find-wallet?userID=user123',
                        'GET /find-wallet?walletAddress=9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
                    ]
                };
                
                return res.status(status).json({ error: true, message, details });
            }
            
            let relationPDA: PublicKey;
            let searchType: string;
            let searchValue: string;
            
            if (userID) {
                // Search by user ID - use "user_id_to_wallet" seed
                searchType = 'userID';
                searchValue = userID as string;
                
                try {
                    [relationPDA] = PublicKey.findProgramAddressSync(
                        [Buffer.from("user_id_to_wallet"), Buffer.from(userID as string)],
                        dependencies.user_key_relations_program.programId
                    );
                } catch (error) {
                    const status = 400;
                    const message = "Input validation failed";
                    const details = {
                        validationErrors: [{
                            type: 'invalid_format',
                            field: 'userID',
                            message: 'Invalid user ID format. Must be a string.'
                        }],
                        userID,
                        example: 'GET /find-wallet?userID=9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
                    };
                    return res.status(status).json({ error: true, message, details });
                }

            } else {
                // Search by wallet address - use "wallet_to_user_id" seed
                searchType = 'walletAddress';
                searchValue = walletAddress as string;
                
                try {
                    const publicKey = new PublicKey(walletAddress as string);
                    [relationPDA] = PublicKey.findProgramAddressSync(
                        [Buffer.from("wallet_to_user_id"), publicKey.toBuffer()],
                        dependencies.user_key_relations_program.programId
                    );
                } catch (error) {
                    const status = 400;
                    const message = "Input validation failed";
                    const details = {
                        validationErrors: [{
                            type: 'invalid_format',
                            field: 'walletAddress',
                            message: 'Invalid wallet address format. Must be a valid Solana public key.'
                        }],
                        walletAddress,
                        example: 'GET /find-wallet?walletAddress=9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
                    };
                    
                    return res.status(status).json({ error: true, message, details });
                }
            }

            // Fetch the relation account
            try {
                const relation = await dependencies.user_key_relations_program.account.userKeyRelation.fetch(relationPDA);
            
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
                const status = 409;
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

        } catch (error: any) {
            logger.error('❌ Error in find wallet handler:', error);
            
            const status = 500;
            const message = "We have a problem! Something went wrong on our end. Our team has been notified.";
            const details = {
                error: error instanceof Error ? error.message : 'Unknown error'
            };

            return res.status(status).json({ error: true, message, details });
        }
    };
};
