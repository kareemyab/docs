import { Request, Response } from 'express';
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js';

export const linkWalletHandler = (dependencies: any) => {
    return async (req: Request, res: Response) => {
        const { logger } = dependencies;
        try {
            const { userID, walletAddress } = req.body;

            // Input validation using the helper function
            const validation = dependencies.validateFields({ userID, walletAddress });
            const errors = [];

            if (validation.missing.length > 0) {
                errors.push({ type: 'missing_fields', fields: validation.missing, message: 'Missing input fields' });
            }

            if (validation.invalidTypes.length > 0) {
                errors.push({ type: 'invalid_types', fields: validation.invalidTypes, message: 'Invalid input types. Must be a string' });
            }

            // Additional validation for wallet address format
            if (walletAddress) {
                try {
                    new PublicKey(walletAddress);
                } catch (error) {
                    errors.push({
                        type: 'invalid_format',
                        field: 'walletAddress',
                        message: 'Invalid wallet address format. Must be a valid Solana public key.'
                    });
                }
            }

            if (userID && userID.length > 200) {
                errors.push({
                    type: 'invalid_value',
                    field: 'userID',
                    message: 'User ID is too long. A maximum of 1000 characters is allowed.'
                });
            }

            if (errors.length > 0) {
                const status = 400;
                const message = 'Input validation failed';
                const details = {
                    validationErrors: errors
                };
                return res.status(status).json({ error: true, message, details });
            }


            const publicKey = new PublicKey(walletAddress);

            const [userIdToWalletRelationPDA] = PublicKey.findProgramAddressSync(
                [Buffer.from("user_id_to_wallet"), Buffer.from(userID)],
                dependencies.user_key_relations_program.programId
            );

            const [walletToUserIdRelationPDA] = PublicKey.findProgramAddressSync(
                [Buffer.from("wallet_to_user_id"), publicKey.toBuffer()],
                dependencies.user_key_relations_program.programId
            );

            // Check if either of the relations already exists
            try {
                const userIdRelation = await dependencies.user_key_relations_program.account.userKeyRelation.fetch(userIdToWalletRelationPDA);
                if (userIdRelation) {
                    const status = 409;
                    const message = `A wallet is already associated with the User ID: ${userID}.`;
                    const details = {
                        conflictType: 'User ID already linked',
                        userID: userID,
                        existingWallet: userIdRelation.userPublicKey.toString(),
                        suggestion: 'Use a different User ID or unlink the existing wallet first'
                    };
                    return res.status(status).json({ error: true, message, details });
                }
            } catch (error) {
                // Expected if account does not exist
            }

            try {
                const walletRelation = await dependencies.user_key_relations_program.account.userKeyRelation.fetch(walletToUserIdRelationPDA);
                if (walletRelation) {
                    const status = 409;
                    const message = `This wallet address is already linked to a User ID: ${walletRelation.userId}.`;
                    const details = {
                        conflictType: 'Wallet already linked',
                        walletAddress: walletAddress,
                        existingUserID: walletRelation.userId,
                        suggestion: 'Use a different wallet address or unlink the existing relation first'
                    };
                    return res.status(status).json({ error: true, message, details });
                }
            } catch (error) {
                // Expected if account does not exist
            }

            const transaction = await dependencies.user_key_relations_program.methods
                .storeUserKeyRelation(userID)
                .accounts({
                    userPublicKey: publicKey,
                    userIdToWalletRelation: userIdToWalletRelationPDA,
                    walletToUserIdRelation: walletToUserIdRelationPDA,
                    feePayer: dependencies.feePayer.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .transaction();

            
    
            const result = await dependencies.submitTransaction(transaction, null, dependencies.connection);

            if (result.error) {
                const status = 500;
                const message = result.error;
                return res.status(status).json({ error: true, message });
            }

            const status = 200;
            const message = "Success! The wallet address has been linked to the user ID.";
            
            return res.status(status).json({
                message,
                details: {
                    userID,
                    walletAddress,
                    transactionSignature: result.signature,
                    explorerUrl: `https://explorer.solana.com/tx/${userIdToWalletRelationPDA.toBase58()}?${dependencies.EXPLORER_CLUSTER_PARAM}`
                }
            });

        } catch (error: any) {
            logger.error('💥 Error storing user key relation:', error.message || error);
            const status = 500;
            const message = "We have a problem! Something went wrong on our end. Our team has been notified.";
            return res.status(status).json({ error: true, message, details: { error: error.message } });
        }
    }
};
