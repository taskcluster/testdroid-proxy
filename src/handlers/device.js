import assert from 'assert';
import Debug from 'debug';
import util from 'util';
import { sleep } from '../util';
import { getSignedUrl } from '../lib/auth';

let debug = Debug('testdroid-proxy:handler:device');

const PROXY_HOST = '54.67.13.230';

// Flash project as defined within the Testdroid Cloud.  Flash project must be
// able to accept a build URL to flash onto the device.  'flash-fxos-new-url' is
// used for Taskcluster signed build urls. 'flash-fxos' is used for PVT builds.
const FLASH_PROJECT_NAME = 'flash-fxos-new-url';

export default class {
  constructor(config) {
    assert(config.testdroid.client, 'Testdroid client is required');
    assert(config.taskcluster.credentials, 'Taskcluster credentials are required');
    this.flashStatus = undefined;
    this.client = config.testdroid.client;
    this.taskclusterCredentials = config.taskcluster.credentials;
  }

  /**
   * Will flash a given deviceType with the build package found at buildUrl.
   *
   * @param {String} deviceType - Type of device that testdroid is aware of. Example: 't2m flame'
   * @param {String} buildUrl - Location of the build packge used for flashing the device
   *
   */
  async flashDevice(filter) {
    let flashDeviceFilter = {};
    for(let filterName in filter) {
      // When finding a device to flash, do not include build and memory in the filter
      if (['build', 'memory'].indexOf(filterName) === -1) {
        flashDeviceFilter[filterName] = filter[filterName];
      }
    }

    let client = this.client;
    let project = await client.getProject(FLASH_PROJECT_NAME);
    let testRun = await project.createTestRun();

    let projectTestRunConfig = await project.getTestRunConfig(testRun);

    let testRunParams = await testRun.getParameters();
    for (let i = 0; i < testRunParams.length; i++) {
      await project.deleteTestRunParameter(testRun, testRunParams[i]);
    }

    await project.createTestRunParameter(testRun, {'key': 'FLAME_ZIP_URL', 'value': filter.build});
    await project.createTestRunParameter(testRun, {'key': 'MEM_TOTAL', 'value': filter.memory});

    let devices = await client.getDevices(flashDeviceFilter);
    // find devices that are online (adb responsive) and not locked (no existing session)
    let device = devices.find((device) => {
      return (device.online === true && device.locked === false);
    });

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
    if(!devices.length) return;
    let session;
    for(let device of devices) {
      let retries = 5;
      // Try a few times to start a device session.
      while (--retries >= 0) {
        try {
          debug(`Attempting to create device session for ${device.id}.`);
          session = await this.client.startDeviceSession(device.id);
          return session;
        }
        catch (e) {
          debug(`Could not start device session for ${device.id}. Retries left: ${retries}. ${e}`);
          // Noticed a delay between flashing and starting a device session
          await sleep(2000);
        }
      }
    }

    return null;
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
   * @param {String} filter - A filter of device capabilities used for finding a device
   * @param {Number} maxRetries - Number of times to retry flashing/finding device
   *
   * @returns {Object} device - Device object that has session and proxy information.
   */
  async getDevice(filter, maxRetries) {
    let client = this.client;
    let device, session;
    filter.build = getSignedUrl(
      filter.build,
      this.taskclusterCredentials.clientId,
      this.taskclusterCredentials.accessToken
    );

    while (--maxRetries >= 0) {
      let devices = await this.getOnlineDevices(filter, 1);
      // If device exists with the given filter, try to get session
      session = await this.getDeviceSession(devices);
      // Return if there is a session, otherwise run flash project
      if(session) break;
      // If no label or can't create a device session, flash something and try again
      await this.flashDevice(filter);

      devices = await this.getOnlineDevices(filter);
      session = await this.getDeviceSession(devices);
      if (session) break;
    }

    if (!session) return;
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
        },
        proxyHost: PROXY_HOST
      };
    }
    catch (e) {
      // If proxies cannot be created for some reason, release the session
      debug(e);
      await client.stopDeviceSession(session.id);
    }

    return device;
  }

  /**
   * Attempt to find an online device with the given filter.  Because of the delay
   * between flashing and the device being ready for ADB, there is a retry with
   * delay that can be adjusted later.
   *
   * @param {Object} filter
   * @param {Number} retries
   *
   * @returns {Array} devices
   */
  async getOnlineDevices(filter, retries=5) {
    // Search for online device for 10 seconds.  Delay between flashing and device coming online
    let onlineDevices;
    while (--retries >= 0) {
      debug(`Attempting to find online vailable device. Retries left: ${retries}`);
      let devices = await this.client.getDevices(filter);
      if(!devices.length) continue;

      onlineDevices = devices.filter((device) => {
        return (device.online === true && device.locked === false);
      });

      if(onlineDevices.length) return onlineDevices;

      await sleep(2000);
    }

    debug("Could't find online device");
    return [];
  }

  /**
   * Retrieve the properties of a device and turn them into a group name = label
   * object that can be passed as testvars.
   *
   * @param {Object} device
   *
   * @returns {Object}
   */
  async getDeviceProperties(device) {
    let propertyData = await this.client.getDeviceProperties(device);
    let properties = {};
    for(let property of propertyData) {
      let groupName = property['propertyGroupName'].toLowerCase().replace(" ", "_");
      let value = property['displayName'];
      if(groupName in properties) {
        if (typeof(properties[groupName]) === Array) {
          properties[groupName].push(value);
        }
        else {
          properties[groupName] = [properties[groupName], value];
        }
        continue;
      }
      properties[groupName] = value;
    }

    return properties;
  }
}
