#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import { CoreApiSDK } from '@trust-engine/sdk'

const program = new Command();
const api = new CoreApiSDK('https://core-api-server.onrender.com');

function output(data, defaultDisplay, jsonFlag) {
    if (jsonFlag) {
        console.log(JSON.stringify(data, null, 2));
    } else {
        defaultDisplay(data);
    }
}

function handleError(error, context) {
    if (program.opts().json) {
        console.log(JSON.stringify({ 
            error: true, 
            context,
            statusCode: error.statusCode,
            message: error.message,
            details: error.details 
        }, null, 2));
        process.exit(1);
    }

    // Handle API errors with detailed information
    if (error.statusCode) {
        console.error(`❌ ${context}:`);
        console.error(`   ${error.message}`);
        
        // Handle validation errors (400)
        if (error.statusCode === 400 && error.details?.validationErrors) {
            console.error('\n📋 Validation Issues:');
            error.details.validationErrors.forEach(validation => {
                if (validation.field) {
                    console.error(`   • ${validation.field}: ${validation.message}`);
                } else {
                    console.error(`   • ${validation.message}`);
                }
            });
        }
        
        // Handle conflicts (409)
        else if (error.statusCode === 409 && error.details) {
            if (error.details.conflictType) {
                console.error(`\n⚠️  Conflict Details:`);
                console.error(`   • Type: ${error.details.conflictType}`);
            }
            if (error.details.suggestion) {
                console.error(`\n💡 Suggestion:`);
                console.error(`   ${error.details.suggestion}`);
            }
        }
        
        // Handle not found (404)
        else if (error.statusCode === 404 && error.details?.suggestion) {
            console.error(`\n💡 Suggestion:`);
            console.error(`   ${error.details.suggestion}`);
        }
        
        // Show additional details if available
        if (error.details && Object.keys(error.details).length > 0) {
            const relevantDetails = { ...error.details };
            delete relevantDetails.validationErrors;
            delete relevantDetails.suggestion;
            delete relevantDetails.conflictType;
            
            if (Object.keys(relevantDetails).length > 0) {
                console.error(`\n📄 Additional Info:`);
                Object.entries(relevantDetails).forEach(([key, value]) => {
                    if (typeof value === 'string' && value.length < 100) {
                        const formattedKey = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
                        console.error(`   • ${formattedKey}: ${value}`);
                    }
                });
            }
        }
    } else {
        // Handle network/SDK errors
        console.error(`❌ ${context}:`);
        console.error(`   ${error.message}`);
    }
    
    process.exit(1);
}

program
    .name('trust-engine-cli')
    .description('CLI for interacting with the Trust Engine API')
    .version('1.1.1')
    .option('--json', 'Output the result as JSON');

program
    .command('register')
    .description('Register a file with the Core API')
    .requiredOption('-f, --file <path>', 'Path to the file to register')
    .requiredOption('-t, --contentTitle <title>', 'Title for the content')
    .requiredOption('-w, --walletAddress <address>', 'User wallet address (Solana public key)')
    .requiredOption('-y, --walletType <type>', "Wallet type: 'standard' or 'crossmint'")
    .option('-r, --returnActionLink', 'Return an action link for the transaction')
    .option('-m, --metadata <text>', 'Public metadata as a string', '')
    .option('-s, --secret <text>', 'Optional raw text secret for claim hash generation')
    .action(async (options) => {
        try {
            const { file, contentTitle, walletAddress, walletType, metadata, secret, returnActionLink } = options;
            const fileBuffer = fs.readFileSync(path.resolve(file));
            const fileObject = new File([new Blob([fileBuffer])], path.basename(file));

            const result = await api.registerFile({
                file: fileObject,
                contentTitle,
                walletAddress,
                walletType,
                metadata: metadata,
                secret,
                returnActionLink: !!returnActionLink // Convert to boolean
            });

            output(result, (data) => {
                console.log(`✅ ${data.message}`);
                console.log("\nRegistration Details:");
                
                if (data.details.status) {
                    console.log(`  - Status: ${data.details.status}`);
                    if (data.details.status === 'requires-client-signature') {
                        console.log(`  - Sign the transaction using your wallet and submit it using the following command:`)
                        console.log(`    trust-engine-cli submit-transaction --transaction <signed_base64_transaction>`);
                    } else if (data.details.status === 'action-link-created') {
                        console.log(`  - Action Link: ${data.details.actionLink}`);
                        console.log(`  - Token: ${data.details.token}`);
                        console.log(`  - Expires At: ${data.details.expiresAt}`);
                        console.log(`  - Visit the action link to sign the transaction via your browser wallet.`);
                    }
                }
                if (data.details.transactionSignature) {
                    console.log(`  - Transaction Signature: ${data.details.transactionSignature}`);
                }
                if (data.details.transaction) {
                    console.log(`  - Transaction (Base64): ${data.details.transaction.substring(0, 50)}...`);
                }
                if (data.details.contentRegistrationPDA) {
                    console.log(`  - Content Registration PDA: ${data.details.contentRegistrationPDA}`);
                }
                if (data.details.contentHash) {
                    console.log(`  - Content Hash: ${data.details.contentHash}`);
                }
                if (data.details.ipfsCid) {
                    console.log(`  - IPFS CID: ${data.details.ipfsCid}`);
                }
                if (data.details.explorerUrl) {
                    console.log(`  - Explorer URL: ${data.details.explorerUrl}`);
                }
            }, program.opts().json);

        } catch (error) {
            handleError(error, 'File registration failed');
        }
    });

program
    .command('link-wallet')
    .description("Link a wallet to a user ID")
    .requiredOption('-u, --userID <id>', 'User ID (alphanumeric string)')
    .requiredOption('-w, --walletAddress <address>', 'Wallet address (Solana public key)')
    .action(async (options) => {
        try {
            const { userID, walletAddress } = options;
            const result = await api.linkWallet({ userID, walletAddress });

            output(result, (data) => {
                console.log(`✅ ${data.message}`);
                console.log("\nDetails:");
                console.log(`  - User ID: ${data.details.userID}`);
                console.log(`  - Wallet Address: ${data.details.walletAddress}`);
                console.log(`  - Transaction Signature: ${data.details.transactionSignature}`);
                console.log(`  - Explorer URL: ${data.details.explorerUrl}`);
            }, program.opts().json);

        } catch (error) {
            handleError(error, 'Wallet linking failed');
        }
    });

program
    .command('search-file')
    .description('Search for a file by its content hash')
    .requiredOption('-f, --file <path>', 'Path to the file to search for')
    .option('-w, --walletAddress <address>', 'Wallet address to search for (Solana public key)')
    .action(async (options) => {
        try {
            const { file, walletAddress } = options;
            const fileBuffer = fs.readFileSync(path.resolve(file));
            const fileObject = new File([new Blob([fileBuffer])], path.basename(file));

            let result;
            if (walletAddress) {
                result = await api.searchFile({ file: fileObject, walletAddress });
            } else {
                result = await api.searchFile({ file: fileObject });
            }

            output(result, (data) => {
                console.log(`✅ ${data.message}`);
                
                console.log("\nSearch Information:");
                console.log(`  - Search Mode: ${data.searchMode}`);
                console.log(`  - Content Hash: ${data.searchCriteria.contentHash}`);
                if (data.searchCriteria.walletAddress) {
                    console.log(`  - Wallet Address: ${data.searchCriteria.walletAddress}`);
                }
                console.log(`  - Total Results: ${data.totalResults}`);
                
                if (data.registrations && data.registrations.length > 0) {
                    console.log("\nRegistration Details:");
                    data.registrations.forEach((registration, index) => {
                        console.log(`\n--- Registration ${index + 1} ---`);
                        console.log(`  - Content Hash: ${registration.contentHash}`);
                        console.log(`  - PDA Address: ${registration.pdaAddress}`);
                        console.log(`  - IPFS CID: ${registration.ipfsCid}`);
                        console.log(`  - Registered By: ${registration.registeredBy}`);
                        console.log(`  - User ID: ${registration.userID || 'N/A'}`);
                        console.log(`  - Timestamp: ${registration.timestamp}`);
                        console.log(`  - Validation Status: ${registration.validationStatus}`);
                        console.log(`  - Consensus: ${registration.consensus}`);
                        console.log(`  - Explorer URL: ${registration.explorerUrl}`);
                    });
                } else {
                    console.log("\nNo registrations found for this content.");
                }
            }, program.opts().json);

        } catch (error) {
            handleError(error, 'File search failed');
        }
    });

program
    .command('create-wallet')
    .description('Create a new wallet for a user')
    .requiredOption('-u, --userID <id>', 'User ID for the new wallet (alphanumeric string)')
    .action(async (options) => {
        try {
            const { userID } = options;
            const result = await api.createWallet({ userID });

            output(result, (data) => {
                console.log(`✅ ${data.message}`);
                console.log("\nWallet Details:");
                console.log(`  - User ID: ${data.details.userID}`);
                console.log(`  - Wallet Address: ${data.details.walletAddress}`);
                console.log(`  - Chain: ${data.details.chain}`);
                console.log(`  - Transaction Signature: ${data.details.transactionSignature}`);
                console.log(`  - Explorer URL: ${data.details.explorerUrl}`);
            }, program.opts().json);

        } catch (error) {
            handleError(error, 'Wallet creation failed');
        }
    });

program
    .command('find-wallet')
    .description('Find a wallet by user ID or wallet address')
    .option('-u, --userID <id>', 'User ID to search for (alphanumeric string)')
    .option('-w, --walletAddress <address>', 'Wallet address to search for (Solana public key)')
    .action(async (options) => {
        try {
            const { userID, walletAddress } = options;
            if (!userID && !walletAddress) {
                throw new Error('You must provide either a userID or a walletAddress.');
            }
            const result = await api.findWallet({ userID, walletAddress });

            output(result, (data) => {
                console.log(`✅ ${data.message}`);
                console.log("\nSearch Details:");
                console.log(`  - Search Type: ${data.details.searchType}`);
                console.log(`  - Search Value: ${data.details.searchValue}`);
                
                if (data.details.relation) {
                    console.log("\nWallet Association Found:");
                    console.log(`  - User ID: ${data.details.relation.userId}`);
                    console.log(`  - Wallet Address: ${data.details.relation.walletAddress}`);
                    console.log(`  - Created At: ${data.details.relation.createdAt}`);
                    console.log(`  - Relation PDA: ${data.details.relation.relationPDA}`);
                }
            }, program.opts().json);

        } catch (error) {
            handleError(error, 'Wallet lookup failed');
        }
    });

program
    .command('get-validator-data')
    .description("Get a validator's data")
    .requiredOption('-w, --walletAddress <address>', 'Wallet address of the validator (Solana public key)')
    .action(async (options) => {
        try {
            const { walletAddress } = options;
            const result = await api.getValidatorData({ walletAddress });

            output(result, (data) => {
                console.log(`✅ ${data.message}`);
                console.log(`\nValidator Data for ${walletAddress}:`);
                console.log(`  - Validator Address: ${data.details.validatorAddress}`);
                console.log(`  - Validator PDA: ${data.details.validatorPDA}`);
                console.log(`  - Staked Amount: ${data.details.stakedAmount}`);
                console.log(`  - Reputation Score: ${data.details.reputationScore}`);
                console.log(`  - Total Votes: ${data.details.totalVotes}`);
                console.log(`  - Honest Votes: ${data.details.honestVotes}`);
                console.log(`  - Dishonest Votes: ${data.details.dishonestVotes}`);
                console.log(`  - Accuracy Percentage: ${data.details.accuracyPercentage}%`);
                console.log(`  - Last Active Time: ${data.details.lastActiveTime}`);
                console.log(`  - Last Active Date: ${data.details.lastActiveDate}`);
            }, program.opts().json);

        } catch (error) {
            handleError(error, 'Validator data retrieval failed');
        }
    });

program
    .command('submit-transaction')
    .description('Submit a signed transaction to the network')
    .requiredOption('-t, --transaction <data>', 'Signed transaction in base64 format')
    .action(async (options) => {
        try {
            const { transaction } = options;
            const result = await api.submitTransaction({ base64Transaction: transaction });

            output(result, (data) => {
                console.log(`✅ ${data.message}`);
                console.log("\nTransaction Details:");
                console.log(`  - Transaction Signature: ${data.details.transactionSignature}`);
                console.log(`  - Explorer URL: ${data.details.explorerUrl}`);
            }, program.opts().json);

        } catch (error) {
            handleError(error, 'Transaction submission failed');
        }
    });

program.parse(process.argv);