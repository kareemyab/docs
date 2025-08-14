import { Transaction } from '@solana/web3.js';
import { createHash } from 'crypto';
import path from 'path';

const defaultApiBaseUrl = 'https://core-api-server.onrender.com';

const WHITELISTED_EXTENSIONS = [".txt", ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".odp", ".csv", ".rtf", ".html", ".htm", 
                                ".xml", ".json", ".md", ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".ico", ".svg", ".mp3", ".wav", ".mp4", ".mov", 
                                ".avi", ".webm", ".ogg", ".zip", ".rar", ".tar", ".gz", ".7z"]

function validateFile(file: { name: string; size: number }): { isValid: boolean; message: string } {
    const originalName = file.name || 'unknown';
    const ext = path.extname(originalName).toLowerCase();
    const fileSize = file.size || 0;

    const maxSize = 100 * 1024 * 1024; // 100MB
    if (fileSize > maxSize) {
        return { 
            isValid: false, 
            message: `File too large: ${(fileSize / 1024 / 1024).toFixed(2)}MB. Maximum allowed: 100MB` 
        };
    }

    if (!WHITELISTED_EXTENSIONS.includes(ext)) {
        return { 
            isValid: false, 
            message: `File extension ${ext} not allowed. Only ${WHITELISTED_EXTENSIONS.join(", ")} are allowed.` 
        };
    }

    const suspiciousPatterns = [
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i,
        /^\./,
        /\.\./
    ];

    const baseName = path.basename(originalName, ext);
    for (const pattern of suspiciousPatterns) {
        if (pattern.test(baseName)) {
            return { 
                isValid: false, 
                message: `Invalid filename pattern detected: ${originalName}` 
            };
        }
    }

    if (originalName.length > 255) {
        return { 
            isValid: false, 
            message: `Filename too long: ${originalName.length} characters. Maximum: 255` 
        };
    }

    return { isValid: true, message: 'File is valid' };
}

export class CoreApiSDK {
    private apiBaseUrl: string;

    constructor(apiBaseUrl: string = defaultApiBaseUrl) {
        this.apiBaseUrl = apiBaseUrl;
    }

    private async _request(endpoint: string, options: RequestInit = {}) {
        const url = `${this.apiBaseUrl}${endpoint}`;
        
        // Do not set Content-Type for FormData
        const headers = options.body instanceof FormData ? options.headers : {
            'Content-Type': 'application/json',
            ...options.headers,
        };

        const config = {
            ...options,
            headers,
        };

        try {
            const response = await fetch(url, config) as any;

            if (!response.ok) {
                const errorData = await response.json();
                const error = new Error(errorData.message || `API error occurred at ${endpoint}.`);
                (error as any).statusCode = response.status;
                (error as any).details = errorData;
                throw error;
            }

            return response.json();
        } catch (error: any) {
            if (error.statusCode) {
                throw error;
            }
            throw new Error(`SDK request failed: ${error.message}`);
        }
    }

    async registerFile({
        file,
        contentTitle,
        walletAddress,
        walletType,
        metadata,
        secret,
        signTransaction,
    }: {
        file: File;
        contentTitle: string;
        walletAddress: string;
        walletType: 'standard' | 'crossmint';
        metadata?: string;
        secret?: string;
        signTransaction?: (transaction: Transaction) => Promise<Transaction>;
    }) {
        const fileBuffer = Buffer.from(await file.arrayBuffer());
        const validationResult = validateFile({
            name: file.name,
            size: file.size,
        });
        if (!validationResult.isValid) {
            throw new Error(validationResult.message);
        }

        // Create content hash
        const contentHash = createHash('sha256').update(fileBuffer).digest();
        const contentHashHex = contentHash.toString('hex');

        // Generate claim hash if a secret is provided
        let claimHashBytes: Buffer;
        if (secret) {
            const secretBuffer = Buffer.from(secret, 'utf8');
            const combined = Buffer.concat([contentHash, secretBuffer]);
            claimHashBytes = createHash('sha256').update(combined).digest();
        } else {
            claimHashBytes = Buffer.alloc(32); // Default to 32 zero bytes
        }
        const claimHashHex = claimHashBytes.toString('hex');

        // Extract file metadata
        const { fileTypeFromBuffer } = await import('file-type');
        const fileType = await fileTypeFromBuffer(fileBuffer);
        const fileMetadata = {
            fileName: file.name,
            fileSize: file.size,
            mimeType: fileType?.mime || 'N/A',
        };

        const payload = {
            contentTitle,
            walletAddress,
            walletType,
            metadata: metadata,
            claimHash: claimHashHex,
            contentHash: contentHashHex,
            fileMetadata,
        };

        const response = await this._request('/register', {
            method: 'POST',
            body: JSON.stringify(payload),
        }) as any;

        if (response.details.status === 'requires-client-signature' && walletType === 'standard') {
            if (!signTransaction) {
                throw new Error('Client signature required but no signTransaction function provided');
            }
            const transaction = Transaction.from(Buffer.from(response.details.transaction, 'base64'));
            const signedTransaction = await signTransaction(transaction);
            const signedTransactionBase64 = signedTransaction.serialize({ requireAllSignatures: false }).toString('base64');
            return this.submitTransaction({ base64Transaction: signedTransactionBase64 });
        }

        return response;
    }

    async linkWallet({ userID, walletAddress }: { userID: string, walletAddress: string }) {
        return this._request('/link-wallet', {
            method: 'POST',
            body: JSON.stringify({ userID, walletAddress }),
        });
    }

    async searchFile(file: File, walletAddress?: string) {
        const fileBuffer = Buffer.from(await file.arrayBuffer());
        const contentHash = createHash('sha256').update(fileBuffer).digest();
        const contentHashHex = contentHash.toString('hex');

        return this._request('/search', {
            method: 'POST',
            body: JSON.stringify({ contentHash: contentHashHex, walletAddress }),
        });
    }

    async createWallet({ userID }: { userID: string }) {
        return this._request('/create-wallet', {
            method: 'POST',
            body: JSON.stringify({ userID }),
        });
    }

    async findWallet({ userID, walletAddress }: { userID?: string, walletAddress?: string }) {
        const params = new URLSearchParams();
        if (userID) params.append('userID', userID);
        if (walletAddress) params.append('walletAddress', walletAddress);
        return this._request(`/find-wallet?${params.toString()}`);
    }

    async getValidatorData({ walletAddress }: { walletAddress: string }) {
        return this._request('/validators/data', {
            method: 'POST',
            body: JSON.stringify({ walletAddress }),
        });
    }

    async submitTransaction({ base64Transaction }: { base64Transaction: string }) {
        return this._request('/transactions', {
            method: 'POST',
            body: JSON.stringify({ transaction: base64Transaction }),
        });
    }
}