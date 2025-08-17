import { Request, Response } from 'express';
import { PublicKey } from '@solana/web3.js';

export const getValidatorDataHandler = (dependencies: any) => {
    return async (req: Request, res: Response) => {
        const { logger } = dependencies;
        try {
            const { walletAddress } = req.body;

            // Input validation using the helper function
            const validation = dependencies.validateFields({ walletAddress });
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

            if (errors.length > 0) {
                const status = 400;
                const message = 'Input validation failed';
                const details = {
                    validationErrors: errors
                };
                return res.status(status).json({ error: true, message, details });
            }

            const validatorPubkey = new PublicKey(walletAddress);
            const [validatorPDA] = PublicKey.findProgramAddressSync(
                [Buffer.from("validator"), validatorPubkey.toBuffer()],
                dependencies.staking_program.programId
            );

            let validatorAccount;
            try {
                validatorAccount = await dependencies.staking_program.account.validator.fetch(validatorPDA);
            } catch (error: any) {
                const status = 409;
                const message = "Validator account not found. This validator may not be initialized.";
                const details = {
                    walletAddress: walletAddress,
                    expectedPDA: validatorPDA.toBase58(),
                    suggestion: 'Initialize the validator using the /validators/initialize endpoint first.'
                };
                return res.status(status).json({ error: true, message, details });
            }

            const totalVotes = validatorAccount.totalVotes.toNumber();
            const honestVotes = validatorAccount.honestVotes.toNumber();
            const dishonestVotes = validatorAccount.dishonestVotes.toNumber();
            const accuracyPercentage = totalVotes > 0 ? ((honestVotes / totalVotes) * 100).toFixed(2) : "N/A";
            const lastActiveDate = validatorAccount.lastActiveTime.toNumber() > 0 
                ? new Date(validatorAccount.lastActiveTime.toNumber() * 1000).toISOString()
                : "Never";

            const status = 200;
            const message = "Validator data retrieved successfully.";

            return res.status(status).json({
                message,
                details: {
                    validatorAddress: validatorAccount.validator.toBase58(),
                    validatorPDA: validatorPDA.toBase58(),
                    stakedAmount: validatorAccount.stakedAmount.toNumber(),
                    reputationScore: validatorAccount.reputationScore.toNumber(),
                    totalVotes: totalVotes,
                    honestVotes: honestVotes,
                    dishonestVotes: dishonestVotes,
                    accuracyPercentage: parseFloat(accuracyPercentage) || 0,
                    lastActiveTime: validatorAccount.lastActiveTime.toNumber(),
                    lastActiveDate: lastActiveDate
                }
            });

        } catch (error: any) {
            logger.error('💥 Validator data retrieval error:', error.message || error);
            const status = 500;
            const message = "We have a problem! Something went wrong on our end. Our team has been notified.";
            return res.status(status).json({ error: true, message, details: { error: error.message } });
        }
    };
};
