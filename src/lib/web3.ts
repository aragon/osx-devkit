import { Wallet, ethers } from 'ethers';
import axios from 'axios';

import { getWallet } from './wallet';
import { getTenderlySettings } from './keys';
import { exitWithMessage, logs, networks, warning } from './constants';
import {
  spinnerError,
  spinnerSuccess,
  stopSpinner,
  updateSpinnerText,
} from './spinners';
import {
  ContractArtifact,
  ContractDeploymentResult,
  ForkResult,
  Network,
  TenderlySettings,
} from 'src/types';

/**
 * Deploys a contract to a specified network and returns the contract address and transaction hash.
 *
 * @param {string} rpc - The RPC URL of the network to deploy the contract to.
 * @param {ContractArtifact} contractBuild - The build of the contract to be deployed.
 * @returns {Promise<ContractDeploymentResult>} A promise that resolves to an object containing the contract address and transaction hash.
 * @throws Will throw an error if the contract deployment fails.
 */
export const deployContract = async (
  rpc: string,
  contractBuild: ContractArtifact,
): Promise<ContractDeploymentResult> => {
  const wallet = await getWallet();
  const provider = new ethers.providers.JsonRpcProvider(rpc);
  let address, txHash;
  const pluginSetup = new ethers.ContractFactory(
    contractBuild.abi,
    contractBuild.bytecode,
    wallet?.connect(provider),
  );

  try {
    updateSpinnerText('Deploying contract...');
    const instance = await pluginSetup.deploy();
    await instance.deployed();
    address = instance.address;
    txHash = instance.deployTransaction.hash;
    stopSpinner();
  } catch (error) {
    spinnerError('Failed to deploy contract');
    console.error(error);
    process.exit(1);
  }

  return { address, txHash };
};

/**
 * Forks a network using the Tenderly API and provides the fork details.
 *
 * @param {string} networkId - The ID of the network to be forked. Defaults to '1'.
 * @returns {Promise<ForkResult>} A promise that resolves to an object containing the forkId, rpcUrl, forkUrl, and forkProvider.
 * @throws Will throw an error if the Tenderly settings are not found.
 */
export const tenderlyFork = async (networkId = '1'): Promise<ForkResult> => {
  const { tenderlyKey, tenderlyUsername, tenderlyProject } =
    (await getTenderlySettings()) as TenderlySettings;

  // If any of the tenderly settings are missing, exit
  if (!tenderlyKey || !tenderlyUsername || !tenderlyProject)
    exitWithMessage('Tenderly settings not found');

  const fork = await axios.post(
    `https://api.tenderly.co/api/v1/account/${tenderlyUsername}/project/${tenderlyProject}/fork`,
    { network_id: networkId },
    { headers: { 'X-Access-Key': tenderlyKey as string } },
  );

  const forkId = fork.data.simulation_fork.id;
  const rpcUrl = `https://rpc.tenderly.co/fork/${forkId}`;
  const forkUrl = `https://dashboard.tenderly.co/${tenderlyUsername}/${tenderlyProject}/fork/${forkId}`;
  const forkProvider = new ethers.providers.JsonRpcProvider(rpcUrl);

  return { forkId, rpcUrl, forkUrl, forkProvider };
};

/**
 * Simulates the deployment of a contract to a specified network.
 *
 * @param {ContractArtifact} contractBuild - The artifact representing the contract to be deployed.
 * @param {string} networkId - The ID of the network on which to simulate deployment.
 * @returns {Promise<void>} A Promise that resolves once the deployment simulation has completed.
 * @throws Will throw an error if the deployment simulation fails for any reason.
 */
export const simulateDeployment = async (
  contractBuild: ContractArtifact,
  networkId: string,
): Promise<void> => {
  const { forkUrl, forkProvider } = await tenderlyFork(networkId);

  try {
    updateSpinnerText('Simulating deployment...');
    let wallet = await getWallet();
    wallet = wallet?.connect(forkProvider) as Wallet;

    const contract = new ethers.ContractFactory(
      contractBuild.abi,
      contractBuild.bytecode,
      wallet?.connect(forkProvider),
    );

    await contract.deploy();
    spinnerSuccess('Simulation complete');
    console.log(`\n🧪 Simulation: ${warning(forkUrl)}`);
  } catch (error) {
    const e = error as Error;
    console.error(e.message);
    spinnerError('Failed to simulate deployment');
    process.exit(1);
  }
};

/**
 * Converts Uint8Array to a hex string.
 *
 * @param {Uint8Array} buff - The Uint8Array to be converted.
 * @param {boolean} [skip0x=false] - If true, the '0x' prefix will be omitted from the output string.
 * @returns {string} Hexadecimal representation of the input Uint8Array.
 */
export function bytesToHex(buff: Uint8Array, skip0x?: boolean): string {
  const bytes: string[] = [];
  for (let i = 0; i < buff.length; i++) {
    if (buff[i] >= 16) {
      bytes.push(buff[i].toString(16));
    } else {
      bytes.push('0' + buff[i].toString(16));
    }
  }
  if (skip0x) {
    return bytes.join('');
  } else {
    return '0x' + bytes.join('');
  }
}

/**
 * Finds a network by its name from a predefined list of networks.
 *
 * @param {string} name - The name of the network to be found.
 * @returns {Network} The Network object if found, otherwise exits the process with an error message.
 * @throws Will throw an error if the network name provided does not exist in the networks list.
 */
export const findNetworkByName = (name: string): Network => {
  const network = networks.find((network) => network.name === name);

  if (!network) exitWithMessage(logs.NOT_NETWORK(name));

  return network as Network;
};
