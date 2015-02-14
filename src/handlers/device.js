import Debug from 'debug';
import util from 'util';
import { sleep } from '../util';

let debug = Debug('testdroid-proxy:handler:device');
let buildLabelGroupName = 'Build Identifier';
let flashProjectName = 'flash-fxos';

export default class {
  constructor(testdroid) {
    this.flashStatus = undefined;
    this.client = testdroid;
  }

  /**
   * Will flash a given `deviceType` with the build package found at `buildUrl`.
   *
   * @param {String} deviceType - Type of device that testdroid is aware of. Example: 't2m flame'
   * @param {String} buildUrl - Location of the build packge used for flashing the device
   *
   */
  async flashDevice(deviceType, memory, buildUrl) {
    let client = this.client;
    let project = await client.getProject(flashProjectName);
    let testRun = await project.createTestRun();

    let projectTestRunConfig = await project.getTestRunConfig(testRun);

    let testRunParams = await testRun.getParameters();
    for (let i = 0; i < testRunParams.length; i++) {
      await project.deleteTestRunParameter(testRun, testRunParams[i]);
    }

    await project.createTestRunParameter(testRun, {'key': 'FLAME_ZIP_URL', 'value': buildUrl});
    await project.createTestRunParameter(testRun, {'key': 'MEM_TOTAL', 'value': memory});
    let devices = await client.getDevicesByName(deviceType);
    let device = devices.find(d => d.online === true);
    if (!device) {
      throw new Error("Couldn't find device that is online");
    }

    let deviceIDs = { 'usedDeviceIds[]': device.id };

    let startTestRun = await testRun.start(deviceIDs);
    testRun = await project.getTestRun(testRun);
    let createdAt = new Date(testRun.createTime);
    debug(`Test Run ${testRun.id} created at ${createdAt}`);
    let timeout = Date.now() + 10*60*1000;
    while (testRun.state !== 'FINISHED') {
      debug(`Test Run ${testRun.id} currently ${testRun.state}`);
      if (Date.now() > timeout) {
        let res = await testRun.abort();
        throw new Error(res);
      }
      await sleep(2000);
      testRun = await project.getTestRun(testRun);
    }
    let finishedAt = new Date(Date.now());
    debug(`Test Run ${testRun.id} finished at ${finishedAt}. Duration: ${(finishedAt - createdAt)/1000} seconds.`);
    debug(util.inspect(testRun));
    // TODO: Inspect the test run and see if the success/failure of the run can be inferred.
  }

  /**
   * Returns all devices testdroid is aware of for the user account.
   */
  async getDevices() {
    let devices = await this.client.getDevices();
    return devices;
  }

  /**
   * Attempts to create a device session for one of the devices provided.  Device
   * must be 'online'.  Because of the delay between flashing and creating a device
   * session, a request for a session will be attempted 3 times with a 2 second delay
   * between attempts.
   *
   * @param {Array} devices - List of devices provided by the testdroid api.
   *
   * @returns {Object} session
   */
  async getDeviceSession(devices) {
    let session;
    for(let device of devices) {
      if (!device.online) continue;
      let maxRetries = 10;
      while (maxRetries-- > 0) {
        try {
          session = await this.client.startDeviceSession(device.id);
          return session;
        }
        catch (e) {
          debug(`Could not start device session for ${device.id}. Retries left: ${maxRetries}. ${e}`);
          // Noticed a delay between flashing and starting a device session
          await sleep(1000);
        }
      }
    }

    return session;
  }

  /**
   * Release the device session
   *
   * @param {Object} device - Device object that contains a session.id
   */
  async releaseDevice(device) {
    await this.client.stopDeviceSession(device.session.id);
  }

  /**
   * Attempts to retrieve a device of a particular type with a particular build.
   * Devices are labeled with the build url after flashing and this will find devices
   * with such a label.
   *
   * If no devices can be found matching the build, a device will be flashed.
   * This operation usually takes 3-5 minutes on average.
   *
   * Once a device can be found, ADB and marionette sessions will be created.
   *
   * @param {String} deviceType - Type of device that testdroid is aware of. Example: 't2m flame'
   * @param {String} buildUrl - Location of the build packge used for flashing the device
   *
   * @returns {Object} device - Device object that has session and proxy information.
   */
  async getDevice(deviceType, memory, buildUrl) {
    debug(`Attempting to get a ${deviceType} device with ${memory} mb memory and build ${buildUrl}`);
    let buildLabel = `${memory}_${buildUrl}`;
    let client = this.client;
    let device, session;
    let maxRetries = 2;

    let labelGroup = await client.getLabelGroup(buildLabelGroupName);
    while (maxRetries-- > 0) {
      debug(`Attempting to get a ${deviceType} device with ${buildUrl}. Retries left: ${maxRetries}`);
      // Find out if the label for the build url exists. Label won't exist if
      // build never was flashed before.
      let label = await client.getLabelInGroup(buildLabel, labelGroup);
      // if it does exist, find devices labeled with it
      if (label) {
        let devices = await client.getDevicesWithLabel(label);
        if (devices.length) {
          // If devices with label, try to get session
          session = await this.getDeviceSession(devices);
          // Return if there is a session, otherwise run flash project
          if(session) break;
        }
      }
      // If no label or can't create a device session, flash something and try again
      await this.flashDevice(deviceType, memory, buildUrl);
    }

    if(!session) return;

    // By default, this can take up to 150 seconds
    try {
      let adb = await client.getProxy('adb', session.id);
      let marionette = await client.getProxy('marionette', session.id);
      device = {
        session: session,
        device: session.device,
        proxies: {
          adb: adb,
          marionette: marionette
        }
      };
    }
    catch (e) {
      // If proxies cannot be created for some reason, release the session
      debug(e);
      await client.stopDeviceSession(session.id);
    }

    return device;
  }
}
