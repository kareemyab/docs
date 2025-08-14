import { Request, Response } from 'express';
import { Connection, Transaction } from '@solana/web3.js';

export const transactionsHandler = (dependencies: {
    connection: Connection,
    feePayer: any, // Using 'any' for Keypair type
    createCurlError: Function,
    createCurlSuccess: Function,
    EXPLORER_CLUSTER_PARAM: string,
    logger: any
}) => {
    // Endpoint to sign a transaction with the fee payer and submit it to the network
    return async (req: Request, res: Response) => {
        const { logger } = dependencies;
        try {
            const { transaction: base64Transaction } = req.body;

            if (!base64Transaction) {
                const status = 400;
                const message = "Missing 'transaction' field in the request body.";
                return res.status(status).json({ error: true, message });
            }

            logger.info('📡 Received transaction from client for final signing and submission...');

            // Deserialize the transaction
            const transactionBuffer = Buffer.from(base64Transaction, 'base64');
            const transaction = Transaction.from(transactionBuffer);

            logger.info('✅ Received fully signed transaction from client.');

            transaction.partialSign(dependencies.feePayer);

            // Submit the now fully-signed transaction
            const signature = await dependencies.connection.sendRawTransaction(
                transaction.serialize()
            );

            logger.info(`⏳ Confirming transaction: ${signature}`);

            // Confirm the transaction
            await dependencies.connection.confirmTransaction(signature, 'confirmed');

            logger.info(`✅ Transaction confirmed!`);

            const status = 200;
            const message = "Transaction submitted and confirmed successfully!";
            const details = {
                'Transaction Signature': signature,
                'Explorer URL': `https://explorer.solana.com/tx/${signature}?${dependencies.EXPLORER_CLUSTER_PARAM}`
            };

            return res.status(status).json({
                message,
                details: {
                    transactionSignature: signature,
                    explorerUrl: details['Explorer URL']
                }
            });

        } catch (error: any) {
            logger.error('💥 Error in /submit-transaction:', error.message || error);
            const status = 500;
            const message = "Failed to submit the transaction.";
            return res.status(status).json({ error: true, message, details: { error: error.message } });
        }
    };
};
