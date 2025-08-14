import { Request, Response } from 'express';
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js';

export const linkWalletHandler = (dependencies: any) => {
    return async (req: Request, res: Response) => {
        const { logger } = dependencies;
        try {
            const { userID, walletAddress } = req.body;

            if (!userID || !walletAddress) {
                const status = 400;
                const message = "Hold on! We need a `userID` and `walletAddress` to proceed.";
                const details = {
                    missingFields: [
                        ...(!userID ? ['userID'] : []),
                        ...(!walletAddress ? ['walletAddress'] : [])
                    ]
                };
                return res.status(status).json({ error: true, message, details });
            }

            logger.info('🔗 Storing user key relation...');
            logger.info('   - User ID:', userID);
            logger.info('   - Wallet Address:', walletAddress);

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
                    const message = `A wallet is already associated with the User ID: ${userID}.`;
                    logger.warn(message);
                    return res.status(409).json({ error: true, message });
                }
            } catch (error) {
                // Expected if account does not exist
            }

            try {
                const walletRelation = await dependencies.user_key_relations_program.account.userKeyRelation.fetch(walletToUserIdRelationPDA);
                if (walletRelation) {
                    const message = `This wallet address is already linked to a User ID: ${walletRelation.userId}.`;
                    logger.warn(message);
                    return res.status(409).json({ error: true, message });
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

            
            // We use the walletAddress for the submitTransaction function, but since no tokens are transferred,
            // it will default to the feePayer signing and sponsoring the transaction.
            const { signature: tx } = await dependencies.submitTransaction(transaction, null, dependencies.connection);

            const status = 200;
            const message = "Success! The wallet address has been linked to the user ID.";
            
            return res.status(status).json({
                message,
                details: {
                    userID,
                    walletAddress,
                    transactionSignature: tx,
                    explorerUrl: `https://explorer.solana.com/tx/${tx}?${dependencies.EXPLORER_CLUSTER_PARAM}`
                }
            });

        } catch (error: any) {
            logger.error('💥 Error storing user key relation:', error.message || error);
            const status = 500;
            const message = "Oh no! Something went wrong while storing the user-key relation.";
            return res.status(status).json({ error: true, message, details: { error: error.message } });
        }
    }
};
