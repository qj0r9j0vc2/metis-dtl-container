"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleEventsSequencerBatchInbox = void 0;
const ethers_1 = require("ethers");
const core_utils_1 = require("@metis.io/core-utils");
const utils_1 = require("../../../utils");
const errors_1 = require("./errors");
exports.handleEventsSequencerBatchInbox = {
    getExtraData: async (event, l1RpcProvider) => {
        const l1Transaction = event.transaction;
        const eventBlock = event.block;
        const batchSubmissionData = {};
        let batchSubmissionVerified = false;
        const calldata = core_utils_1.fromHexString(l1Transaction.data);
        if (calldata.length > 70) {
            const offset = 2;
            batchSubmissionData.prevTotalElements = ethers_1.BigNumber.from(calldata.slice(offset + 32, offset + 64)).sub(1);
            batchSubmissionData.batchIndex = ethers_1.BigNumber.from(calldata.slice(offset, offset + 32));
            batchSubmissionData.batchSize = ethers_1.BigNumber.from(calldata.slice(offset + 64, offset + 68));
            batchSubmissionVerified = true;
        }
        if (!batchSubmissionVerified) {
            throw new Error(Well, "this really shouldn't happen. A SequencerBatchInbox data doesn't have a corresponding TransactionBatchAppended event.");
        }
        return {
            timestamp: eventBlock.timestamp,
            blockNumber: eventBlock.number,
            submitter: l1Transaction.from,
            l1TransactionHash: l1Transaction.hash,
            l1TransactionData: l1Transaction.data,
            gasLimit: `${utils_1.SEQUENCER_GAS_LIMIT}`,
            prevTotalElements: batchSubmissionData.prevTotalElements,
            batchIndex: batchSubmissionData.batchIndex,
            batchSize: batchSubmissionData.batchSize,
            batchRoot: eventBlock.parentHash,
            batchExtraData: '',
        };
    },
    parseEvent: async (event, extraData, l2ChainId, options) => {
        const blockEntries = [];
        const calldata = core_utils_1.fromHexString(extraData.l1TransactionData);
        if (calldata.length < 70) {
            throw new Error(
                `Block ${extraData.blockNumber} transaction data of inbox ${extraData.l1TransactionHash} is invalid for decoding: ${extraData.l1TransactionData} , ` +
                `converted buffer length is < 70.`
            )
        }
        const da = ethers_1.BigNumber.from(calldata.slice(0, 1)).toNumber();
        const compressType = ethers_1.BigNumber.from(calldata.slice(1, 2)).toNumber();
        let contextData = calldata.slice(70);
        if (da === 1) {
            const storageObject = core_utils_1.remove0x(core_utils_1.toHexString(contextData));
            let minioClient = null;
            if (options.minioBucket &&
                options.minioAccessKey &&
                options.minioSecretKey &&
                options.minioEndpoint &&
                options.minioPort) {
                const minioConfig = {
                    options: {
                        endPoint: options.minioEndpoint,
                        port: options.minioPort,
                        useSSL: options.minioUseSsl,
                        accessKey: options.minioAccessKey,
                        secretKey: options.minioSecretKey,
                    },
                    l2ChainId,
                    bucket: options.minioBucket,
                };
                minioClient = new core_utils_1.MinioClient(minioConfig);
            }
            else {
                throw new Error("Missing minio config for DA type is 1");
            }
            const daData = await minioClient.readObject(storageObject, 2);
            if (!daData) {
                throw new Error(`Read data from minio failed, object is ${storageObject}`);
            }
            contextData = Buffer.from(daData, 'hex');
        }
        if (compressType === 11) {
            contextData = await core_utils_1.zlibDecompress(contextData);
        }
        let offset = 0;
        let blockIndex = 0;
        const l2Start = ethers_1.BigNumber.from(calldata.slice(2 + 32, 2 + 64)).toNumber();
        let pointerEnd = false;
        while (!pointerEnd) {
            const txCount = ethers_1.BigNumber.from(contextData.slice(offset, offset + 3)).toNumber();
            offset += 3;
            const blockTimestamp = ethers_1.BigNumber.from(contextData.slice(offset, offset + 5)).toNumber();
            offset += 5;
            const l1BlockNumber = ethers_1.BigNumber.from(contextData.slice(offset, offset + 32)).toNumber();
            offset += 32;
            const blockEntry = {
                index: l2Start + blockIndex - 1,
                batchIndex: extraData.batchIndex.toNumber(),
                timestamp: blockTimestamp,
                transactions: [],
                confirmed: true,
            };
            blockIndex++;
            for (let i = 0; i < txCount; i++) {
                const txType = ethers_1.BigNumber.from(contextData.slice(offset, offset + 1)).toNumber();
                offset += 1;
                const txDataLen = ethers_1.BigNumber.from(contextData.slice(offset, offset + 3)).toNumber();
                offset += 3;
                const transactionEntry = {
                    index: blockEntry.index,
                    batchIndex: extraData.batchIndex.toNumber(),
                    blockNumber: l1BlockNumber,
                    timestamp: blockTimestamp,
                    gasLimit: ethers_1.BigNumber.from(0).toString(),
                    target: ethers_1.constants.AddressZero,
                    origin: null,
                    data: '0x',
                    queueOrigin: 'sequencer',
                    value: '0x0',
                    queueIndex: null,
                    decoded: null,
                    confirmed: true,
                    seqSign: null,
                };
                let signData = null;
                if (txType === 0) {
                    const txData = contextData.slice(offset, offset + txDataLen);
                    offset += txDataLen;
                    const decoded = decodeSequencerBatchTransaction(txData, l2ChainId);
                    transactionEntry.data = core_utils_1.toHexString(txData);
                    transactionEntry.value = decoded.value;
                    transactionEntry.decoded = decoded;
                    const signLen = ethers_1.BigNumber.from(contextData.slice(offset, offset + 3)).toNumber();
                    offset += 3;
                    if (signLen > 0) {
                        const decodedSign = core_utils_1.remove0x(core_utils_1.toHexString(contextData.slice(offset, offset + signLen)));
                        offset += signLen;
                        if (decodedSign && decodedSign === '000000') {
                            signData = '0x0,0x0,0x0';
                        }
                        else if (!decodedSign || decodedSign.length < 130) {
                            signData = '';
                        }
                        else {
                            const seqR = '0x' + removeLeadingZeros(decodedSign.substring(0, 64));
                            const seqS = '0x' + removeLeadingZeros(decodedSign.substring(64, 128));
                            let seqV = decodedSign.substring(128);
                            if (seqV.length > 0) {
                                seqV = '0x' + removeLeadingZeros(seqV);
                            }
                            else {
                                seqV = '0x0';
                            }
                            signData = `${seqR},${seqS},${seqV}`;
                        }
                        transactionEntry.seqSign = signData;
                    }
                }
                else {
                    const l1Origin = core_utils_1.toHexString(contextData.slice(offset, offset + 20));
                    offset += 20;
                    const queueIndex = core_utils_1.toHexString(contextData.slice(offset, offset + 16));
                    offset += 16;
                    transactionEntry.origin = l1Origin;
                    transactionEntry.queueIndex = ethers_1.BigNumber.from(queueIndex).toNumber();
                    transactionEntry.queueOrigin = 'l1';
                }
                blockEntry.transactions.push(transactionEntry);
                blockEntries.push(blockEntry);
            }
            if (offset >= contextData.length) {
                pointerEnd = true;
            }
        }
        const transactionBatchEntry = {
            index: extraData.batchIndex.toNumber(),
            root: extraData.batchRoot,
            size: extraData.batchSize.toNumber(),
            prevTotalElements: extraData.prevTotalElements.toNumber(),
            extraData: extraData.batchExtraData,
            blockNumber: ethers_1.BigNumber.from(extraData.blockNumber).toNumber(),
            timestamp: ethers_1.BigNumber.from(extraData.timestamp).toNumber(),
            submitter: extraData.submitter,
            l1TransactionHash: extraData.l1TransactionHash,
        };
        return {
            transactionBatchEntry,
            blockEntries,
        };
    },
    storeEvent: async (entry, db, options) => {
        if (entry.transactionBatchEntry.index > 0) {
            const prevTransactionBatchEntry = await db.getTransactionBatchByIndex(entry.transactionBatchEntry.index - 1);
            if (prevTransactionBatchEntry === null) {
                throw new errors_1.MissingElementError('SequencerBatchInbox');
            }
        }

        for (const block of entry.blockEntries) {
            if (options.deSeqBlock > 0 && block.index + 1 >= options.deSeqBlock) {
                await db.putBlockEntries([block]);
            } else {
                await db.putTransactionEntries(block.transactions);
            }
            for (const transactionEntry of block.transactions) {
                if (transactionEntry.queueOrigin === 'l1') {
                    await db.putTransactionIndexByQueueIndex(transactionEntry.queueIndex, transactionEntry.index);
                }
            }
        }
        await db.putTransactionBatchEntries([entry.transactionBatchEntry]);
    }
};
const parseSequencerBatchContext = (calldata, offset) => {
    return {
        numSequencedTransactions: ethers_1.BigNumber.from(calldata.slice(offset, offset + 3)).toNumber(),
        numSubsequentQueueTransactions: ethers_1.BigNumber.from(calldata.slice(offset + 3, offset + 6)).toNumber(),
        timestamp: ethers_1.BigNumber.from(calldata.slice(offset + 6, offset + 11)).toNumber(),
        blockNumber: ethers_1.BigNumber.from(calldata.slice(offset + 11, offset + 16)).toNumber(),
    };
};
const decodeSequencerBatchTransaction = (transaction, l2ChainId) => {
    const decodedTx = ethers_1.ethers.utils.parseTransaction(transaction);
    return {
        nonce: ethers_1.BigNumber.from(decodedTx.nonce).toString(),
        gasPrice: ethers_1.BigNumber.from(decodedTx.gasPrice).toString(),
        gasLimit: ethers_1.BigNumber.from(decodedTx.gasLimit).toString(),
        value: core_utils_1.toRpcHexString(decodedTx.value),
        target: decodedTx.to ? core_utils_1.toHexString(decodedTx.to) : null,
        data: core_utils_1.toHexString(decodedTx.data),
        sig: {
            v: utils_1.parseSignatureVParam(decodedTx.v, l2ChainId),
            r: core_utils_1.toHexString(decodedTx.r),
            s: core_utils_1.toHexString(decodedTx.s),
        },
    };
};
const removeLeadingZeros = (inputString) => {
    const trimmedString = inputString.replace(/^0+/, '');
    return trimmedString || '0';
};
//# sourceMappingURL=sequencer-batch-inbox.js.map
