import { Pool, PoolClient } from 'pg';
import { webcrypto } from 'crypto';

// Database connection pool
let pool: Pool | null = null;

export function initializeDatabase(databaseUrl: string): Pool {
    if (!pool) {
        pool = new Pool({
            connectionString: databaseUrl,
            ssl: databaseUrl.includes('localhost') || databaseUrl.includes('127.0.0.1') 
                ? false 
                : { rejectUnauthorized: false },
            max: 10, // Maximum number of clients in the pool
            idleTimeoutMillis: 30000, // Close clients after 30 seconds of inactivity
            connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection could not be established
        });

        // Handle pool errors
        pool.on('error', (err) => {
            console.error('Unexpected error on idle client', err);
        });
    }
    return pool;
}

export function getDatabase(): Pool {
    if (!pool) {
        throw new Error('Database not initialized. Call initializeDatabase first.');
    }
    return pool;
}

export async function closeDatabase(): Promise<void> {
    if (pool) {
        await pool.end();
        pool = null;
    }
}

// Generate a cryptographically secure 128-bit token (32 hex characters)
export function generateSecureToken(): string {
    const array = new Uint8Array(16); // 16 bytes = 128 bits
    webcrypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

// Interface for transaction action data
export interface TransactionActionData {
    token: string;
    unsigned_transaction: string;
    creator_pubkey: string;
    content_hash: string;
    content_title?: string;
    expires_at: Date;
}

// Insert a new transaction action record
export async function insertTransactionAction(data: TransactionActionData): Promise<void> {
    const pool = getDatabase();
    const query = `
        INSERT INTO transaction_actions (
            token, unsigned_transaction, creator_pubkey, content_hash, 
            content_title, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6)
    `;
    
    const values = [
        data.token,
        data.unsigned_transaction,
        data.creator_pubkey,
        data.content_hash,
        data.content_title,
        data.expires_at
    ];

    await pool.query(query, values);
}

// Get transaction action by token
// export async function getTransactionAction(token: string): Promise<TransactionActionData | null> {
//     const pool = getDatabase();
//     const query = 'SELECT * FROM transaction_actions WHERE token = $1';
//     const result = await pool.query(query, [token]);
    
//     if (result.rows.length === 0) {
//         return null;
//     }
    
//     const row = result.rows[0];
//     return {
//         token: row.token,
//         unsigned_transaction: row.unsigned_transaction,
//         creator_pubkey: row.creator_pubkey,
//         content_hash: row.content_hash,
//         content_title: row.content_title,
//         expires_at: row.expires_at
//     };
// }

// Update transaction action status
// export async function updateTransactionActionStatus(
//     token: string, 
//     status: 'unused' | 'pending' | 'confirmed' | 'rejected' | 'failed' | 'expired',
//     transactionSignature?: string
// ): Promise<void> {
//     const pool = getDatabase();
//     const query = `
//         UPDATE transaction_actions 
//         SET status = $1, used_at = $2, transaction_signature = $3
//         WHERE token = $4
//     `;
    
//     const values = [
//         status,
//         status !== 'unused' ? new Date() : null,
//         transactionSignature || null,
//         token
//     ];

//     await pool.query(query, values);
// }

// // Clean up expired tokens
// export async function cleanupExpiredTokens(): Promise<number> {
//     const pool = getDatabase();
//     const query = `
//         DELETE FROM transaction_actions 
//         WHERE expires_at < NOW() AND status IN ('unused', 'expired')
//     `;
    
//     const result = await pool.query(query);
//     return result.rowCount || 0;
// }
