import { Request, Response } from 'express';
import { Connection, Transaction } from '@solana/web3.js';

export const transactionsHandler = (dependencies: {
    connection: Connection,
    feePayer: any, // Using 'any' for Keypair type
    EXPLORER_CLUSTER_PARAM: string,
    logger: any,
    validateFields: any
}) => {
    // Endpoint to sign a transaction with the fee payer and submit it to the network
    return async (req: Request, res: Response) => {
        const { logger } = dependencies;
        try {
            const { transaction: base64Transaction } = req.body;

            // Input validation using the helper function
            const validation = dependencies.validateFields({ transaction: base64Transaction });
            const errors = [];

            if (validation.missing.length > 0) {
                errors.push({ type: 'missing_fields', fields: validation.missing, message: 'Missing input fields' });
            }

            if (validation.invalidTypes.length > 0) {
                errors.push({ type: 'invalid_types', fields: validation.invalidTypes, message: 'Invalid input types. Must be a string' });
            }

            // Additional validation for base64 format
            if (base64Transaction) {
                try {
                    Buffer.from(base64Transaction, 'base64');
                } catch (error) {
                    errors.push({
                        type: 'invalid_format',
                        field: 'transaction',
                        message: 'Must be a valid base64 encoded string'
                    });
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


            // Deserialize the transaction
            const transactionBuffer = Buffer.from(base64Transaction, 'base64');
            const transaction = Transaction.from(transactionBuffer);


            transaction.partialSign(dependencies.feePayer);

            // Submit the now fully-signed transaction
            const signature = await dependencies.connection.sendRawTransaction(
                transaction.serialize()
            );


            // Confirm the transaction
            await dependencies.connection.confirmTransaction(signature, 'confirmed');


            const status = 200;
            const message = "Transaction submitted and confirmed successfully!";
            const details = {
                transactionSignature: signature,
                explorerUrl: `https://explorer.solana.com/tx/${signature}?${dependencies.EXPLORER_CLUSTER_PARAM}`
            };

            return res.status(status).json({
                message,
                details
            });

        } catch (error: any) {
            logger.error('💥 Error in /submit-transaction:', error.message || error);
            const status = 500;
            const message = "We have a problem! Something went wrong on our end. Our team has been notified.";
            return res.status(status).json({ error: true, message, details: { error: error.message } });
        }
    };
};
