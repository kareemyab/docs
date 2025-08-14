import { Request, Response } from 'express';
// Crossmint SDK removed for Docker compatibility - implement API calls directly
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { createCrossmint, CrossmintWallets } from '@crossmint/wallets-sdk';

export const createWalletHandler = (dependencies: any) => {
    return async (req: Request, res: Response) => {
        const { logger } = dependencies;
        try {
            const { userID } = req.body;

            if (!userID) {
                const status = 400;
                const message = "Hold on! We need a `userID` to proceed.";
                return res.status(status).json({ error: true, message });
            }

            const [userIdToWalletRelationPDA] = PublicKey.findProgramAddressSync(
                [Buffer.from("user_id_to_wallet"), Buffer.from(userID)],
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

            logger.info('🔐 Creating new Crossmint wallet...');
            logger.info('   - User ID:', userID);

            // const response = await fetch('https://staging.crossmint.com/api/2025-06-09/wallets', {
            //     method: 'POST',
            //     headers: { 'X-API-KEY': dependencies.crossmint_api_server_key, 'Content-Type': 'application/json' },
            //     body: JSON.stringify({ 
            //         chainType: "solana",
            //         type: "smart",
            //         config: {
            //             adminSigner: {
            //                 type: "email",
            //                 email: "hadi@trustengine.org"
            //             }
            //         },
            //         owner: "email:hadi@trustengine.org"
            //     }),
            // })

            // const wallet = await response.json() as any;
            
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

            logger.info('✅ Wallet created successfully:', wallet.address);

            logger.info('🔑 Public key:', publicKey);



            const [walletToUserIdRelationPDA] = PublicKey.findProgramAddressSync(
                [Buffer.from("wallet_to_user_id"), publicKey.toBuffer()],
                dependencies.user_key_relations_program.programId
            );

           

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

            
            
            const { signature: tx } = await dependencies.submitTransaction(transaction, wallet.address, dependencies.connection);

            const status = 201;
            const message = "Success! Your Crossmint wallet has been created and linked to your user ID.";

            return res.status(status).json({
                message,
                details: {
                    walletAddress: wallet.address,
                    chain: "solana",
                    transactionSignature: tx,
                    explorerUrl: `https://explorer.solana.com/tx/${tx}?${dependencies.EXPLORER_CLUSTER_PARAM}`,
                }
            });

        } catch (error: any) {
            logger.error('💥 Error creating wallet:', error.message || error);
            const status = 500;
            const message = "Oh no! Something went wrong while creating your wallet.";
            return res.status(status).json({ error: true, message, details: { error: error.message } });
        }
    };
};
