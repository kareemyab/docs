import { Request, Response } from 'express';
// Crossmint SDK removed for Docker compatibility - implement API calls directly
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { createCrossmint, CrossmintWallets } from '@crossmint/wallets-sdk';

export const createWalletHandler = (dependencies: any) => {
    return async (req: Request, res: Response) => {
        const { logger } = dependencies;
        try {
            const { userID } = req.body;

            // Input validation using the helper function
            const validation = dependencies.validateFields({ userID });
            const errors = [];

            if (validation.missing.length > 0) {
                errors.push({ type: 'missing_fields', fields: validation.missing, message: 'Missing input fields' });
            }

            if (validation.invalidTypes.length > 0) {
                errors.push({ type: 'invalid_types', fields: validation.invalidTypes, message: 'Invalid input types. Must be a string' });
            }

            if (errors.length > 0) {
                const status = 400;
                const message = 'Input validation failed';
                const details = {
                    validationErrors: errors
                };
                return res.status(status).json({ error: true, message, details });
            }

            const [userIdToWalletRelationPDA] = PublicKey.findProgramAddressSync(
                [Buffer.from("user_id_to_wallet"), Buffer.from(userID)],
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
                        suggestion: 'Use a different User ID or use the existing wallet'
                    };
                    logger.warn(message);
                    return res.status(status).json({ error: true, message, details });
                }
            } catch (error) {
                // Expected if account does not exist
            }

            const crossmint = createCrossmint({
                apiKey: dependencies.crossmint_api_server_key,
            });
            
            const crossmintWallets = CrossmintWallets.from(crossmint);
            
            const wallet = await crossmintWallets.createWallet({
                chain: "solana",
                signer: {
                    type: "api-key",
                },
            });

            const publicKey = new PublicKey(wallet.address);

            const [walletToUserIdRelationPDA] = PublicKey.findProgramAddressSync(
                [Buffer.from("wallet_to_user_id"), publicKey.toBuffer()],
                dependencies.user_key_relations_program.programId
            );

            try {
                const walletRelation = await dependencies.user_key_relations_program.account.userKeyRelation.fetch(walletToUserIdRelationPDA);
                if (walletRelation) {
                    const status = 409;
                    const message = `This wallet address is already linked to a User ID: ${walletRelation.userId}.`;
                    const details = {
                        conflictType: 'Wallet already linked',
                        walletAddress: wallet.address,
                        existingUserID: walletRelation.userId,
                        suggestion: 'This should not happen with Crossmint wallet creation'
                    };
                    logger.warn(message);
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

            
            
            const result = await dependencies.submitTransaction(transaction, wallet.address, dependencies.connection);

            if (result.error) {
                const status = 500;
                const message = result.error;
                return res.status(status).json({ error: true, message });
            }

            const status = 201;
            const message = "Success! Your Crossmint wallet has been created and linked to your user ID.";

            return res.status(status).json({
                message,
                details: {
                    walletAddress: wallet.address,
                    chain: "solana",
                    transactionSignature: result.signature,
                    explorerUrl: `https://explorer.solana.com/tx/${userIdToWalletRelationPDA.toBase58()}?${dependencies.EXPLORER_CLUSTER_PARAM}`,
                    userID: userID,
                }
            });

        } catch (error: any) {
            logger.error('💥 Error creating wallet:', error.message || error);
            const status = 500;
            const message = "We have a problem! Something went wrong on our end. Our team has been notified.";
            return res.status(status).json({ error: true, message, details: { error: error.message } });
        }
    };
};
