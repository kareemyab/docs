import { Request, Response } from 'express';

export const healthHandler = (dependencies: any) => {
    return (req: Request, res: Response) => {
        const { logger } = dependencies;
        try {
            logger.info('❤️ Health check endpoint hit');
            
            const status = 200;
            const message = "All systems operational!";
            const details = {
                status: '✅ Operational',
                timestamp: new Date().toISOString()
            };

            return res.status(status).json({ message, details });
            
        } catch (error: any) {
            logger.error('💥 Error in health check:', error.message || error);
            const status = 500;
            const message = "Health check failed. Our team has been notified.";
            return res.status(status).json({ error: true, message, details: { error: error.message } });
        }
    };
};
