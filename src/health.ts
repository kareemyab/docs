import { Request, Response } from 'express';

export const healthHandler = (dependencies: any) => {
    return (req: Request, res: Response) => {
        const { logger } = dependencies;
        logger.info('❤️ Health check endpoint hit');
        const status = 200;
        const message = "All systems operational!";
        const details = {
            'Status': '✅ Operational',
            'Timestamp': new Date().toISOString()
        };

        res.status(status).json({ status: message, timestamp: details['Timestamp'] });
    };
};
