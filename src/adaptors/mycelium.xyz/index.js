const sdk = require('@defillama/sdk');
const utils = require('../utils');
const abi = require('./abis/abi.json');
const { ethers } = require('ethers');

const arbitrumMyc = '0xc74fe4c715510ec2f8c61d70d397b32043f55abe';
const arbitrumMlp = '0x752b746426b6D0c3188bb530660374f92FD9cf7c';
const arbitrumMlpManager = '0x2DE28AB4827112Cd3F89E5353Ca5A8D80dB7018f';
const arbitrumFeeMycTracker = '0x0cA0147c21F9DB9D4627e6a996342A11D25972C5';
const arbitrumInflationMycTracker =
  '0x2BC8E28f5d41a4b112BC62EB7Db1B757c85f37Ff';
const arbitrumFeeMlpTracker = '0xF0BFB95087E611897096982c33B6934C8aBfA083';
const arbitrumInflationMlpTracker =
  '0xF7Bd2ed13BEf9C27a2188f541Dc5ED85C5325306';
const arbitrumMycStaking = '0x9B225FF56C48671d4D04786De068Ed8b88b672d6';

const FORTNIGHTS_IN_YEAR = 365 / 14;
const SECONDS_PER_YEAR = 60 * 60 * 24 * 365;
const CHAIN_STRING = 'arbitrum';
const ETH_DISTRIBUTED_PER_CYCLE = '34.5807416';

const getAdjustedAmount = async (pTarget, pAbi, pParams = []) => {
  const decimals = await sdk.api.abi.call({
    target: pTarget,
    abi: 'erc20:decimals',
    chain: CHAIN_STRING,
  });
  const supply = await sdk.api.abi.call({
    target: pTarget,
    abi: pAbi,
    chain: CHAIN_STRING,
    params: pParams,
  });

  return pAbi == abi['tokensPerInterval']
    ? supply.output * 10 ** -decimals.output * SECONDS_PER_YEAR
    : supply.output * 10 ** -decimals.output;
};

const getMlpTvl = async () => {
  const tvl = await sdk.api.abi.call({
    target: arbitrumMlpManager,
    abi: abi['getAumInUsdg'],
    chain: CHAIN_STRING,
    params: [false],
  });

  return tvl.output * 10 ** -18;
};

const getStakingRewards = async () => {
  const currentCycle = await sdk.api.abi.call({
    target: arbitrumMycStaking,
    abi: abi['cycle'],
    chain: CHAIN_STRING,
  });

  const prevCycle = currentCycle.output - 1;

  const prevCycleEthRewards = await sdk.api.abi.call({
    target: arbitrumMycStaking,
    abi: abi['cycleCumulativeEthRewards'],
    chain: CHAIN_STRING,
    params: [prevCycle],
  });

  return prevCycleEthRewards.output * 10 ** -18;
};

const getStakingTvl = async () => {
  const totalAssets = await sdk.api.abi.call({
    target: arbitrumMycStaking,
    abi: abi['totalAssets'],
    chain: CHAIN_STRING,
  });
  const pendingDeposits = await sdk.api.abi.call({
    target: arbitrumMycStaking,
    abi: abi['pendingDeposits'],
    chain: CHAIN_STRING,
  });

  const totalAssetsBN = ethers.BigNumber.from(totalAssets.output);
  const pendingDepositsBN = ethers.BigNumber.from(pendingDeposits.output);

  return totalAssetsBN.add(pendingDepositsBN) * 10 ** -18;
};

const getPoolMlp = async (
  pTvl,
  pInflationTracker,
  pFeeMlp,
  pInflationMlp,
  pPriceData
) => {
  const yearlyFeeMlp = pFeeMlp * pPriceData.ethereum.usd;
  const yearlyInflationMlp = pInflationMlp * pPriceData.mycelium.usd;
  const apyFee = (yearlyFeeMlp / pTvl) * 100;
  const apyInflation = (yearlyInflationMlp / pTvl) * 100;

  return {
    pool: pInflationTracker,
    chain: utils.formatChain(CHAIN_STRING),
    project: 'mycelium.xyz',
    symbol: utils.formatSymbol('MLP'),
    tvlUsd: parseFloat(pTvl),
    apyBase: apyFee,
    apyReward: apyInflation,
    rewardTokens: [arbitrumMyc],
    underlyingTokens: [arbitrumMyc],
    underlyingTokens: [arbitrumMlp],
  };
};

const getPoolMyc = async (pTvl, pRewards, pStaking, pPriceData) => {
  const mycDeposited = pTvl;
  const ethDistributed = pRewards;
  const mycUsdValue = mycDeposited * pPriceData.mycelium.usd;
  const ethUsdValue = ethDistributed * pPriceData.ethereum.usd;
  const aprPercentageCycle = ethUsdValue / mycUsdValue;
  const aprPercentageYearly = aprPercentageCycle * FORTNIGHTS_IN_YEAR * 100;

  return {
    pool: pStaking,
    chain: utils.formatChain(CHAIN_STRING),
    project: 'mycelium.xyz',
    symbol: utils.formatSymbol('MYC'),
    tvlUsd: parseFloat(mycUsdValue),
    apyBase: aprPercentageYearly,
    apyReward: 0,
    rewardTokens: [arbitrumMyc],
    underlyingTokens: [arbitrumMyc],
    underlyingTokens: [arbitrumMlp],
  };
};

const getPools = async () => {
  const pools = [];

  const priceData = await utils.getData(
    'https://api.coingecko.com/api/v3/simple/price?ids=mycelium%2Cethereum&vs_currencies=usd'
  );

  const arbitrumFeeMlp = await getAdjustedAmount(
    arbitrumFeeMlpTracker,
    abi['tokensPerInterval']
  );
  const arbitrumInflationMlp = await getAdjustedAmount(
    arbitrumInflationMlpTracker,
    abi['tokensPerInterval']
  );
  pools.push(
    await getPoolMlp(
      await getMlpTvl(),
      arbitrumInflationMlpTracker,
      arbitrumFeeMlp,
      arbitrumInflationMlp,
      priceData
    )
  );

  pools.push(
    await getPoolMyc(
      await getStakingTvl(),
      await getStakingRewards(),
      arbitrumMycStaking,
      priceData
    )
  );

  return pools;
};

module.exports = {
  timetravel: false,
  apy: getPools,
  url: 'https://swaps.mycelium.xyz/',
};
