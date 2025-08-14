import { Request, Response } from 'express';
import { PublicKey } from '@solana/web3.js';

export const getValidatorDataHandler = (dependencies: any) => {
    return async (req: Request, res: Response) => {
        const { logger } = dependencies;
        try {
            const { walletAddress } = req.body;
            if (!walletAddress) {
                const status = 400;
                const message = "Hold on! We need a `walletAddress` to fetch validator data.";
                return res.status(status).json({ error: true, message });
            }

            const validatorPubkey = new PublicKey(walletAddress);
            const [validatorPDA] = PublicKey.findProgramAddressSync(
                [Buffer.from("validator"), validatorPubkey.toBuffer()],
                dependencies.staking_program.programId
            );

            logger.info(`📊 Fetching validator data for ${walletAddress} at PDA ${validatorPDA.toBase58()}`);

            try {
                const validatorAccount = await dependencies.staking_program.account.validator.fetch(validatorPDA);
                
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

            } catch (accountError: any) {
                logger.warn(`   - Validator account not found for ${walletAddress}. This validator may not be initialized.`);
                const status = 404;
                const message = "Validator account not found. This validator may not be initialized.";
                const details = {
                    'Wallet Address': walletAddress,
                    'Expected PDA': validatorPDA.toBase58(),
                    'Suggestion': 'Initialize the validator using the /validators/initialize endpoint first.'
                };

                return res.status(status).json({ error: true, message, details });
            }

        } catch (error: any) {
            logger.error('💥 Validator data retrieval error:', error.message || error);
            const status = 500;
            const message = "Oh no! Something went wrong while fetching validator data.";
            return res.status(status).json({ error: true, message, details: { error: error.message } });
        }
    };
};
