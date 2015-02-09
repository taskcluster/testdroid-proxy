import Debug from 'debug';
import util from 'util';

let debug = Debug('testdroid-proxy:handler:device');
let buildLabelGroupName = 'Build version';
let flashProjectName = 'flash-fxos';


function sleep(duration) {
  return new Promise(function(accept) {
    setTimeout(accept, duration);
    });
}
export default class {
  constructor(testdroid) {
    this.flashStatus = undefined;
    this.client = testdroid;
  }

  async flashDevice(deviceType, buildUrl) {
    let t = this.client;
    let project = await t.getProject(flashProjectName);
    let testRun = await project.createTestRun();

    let projectTestRunConfig = await project.getTestRunConfig(testRun);

    let testRunParams = await testRun.getParameters();
    for (let i = 0; i < testRunParams.length; i++) {
      await project.deleteTestRunParameter(testRun, testRunParams[i]);
    }

    let param = await project.createTestRunParameter(testRun, {'key': 'FLAME_ZIP_URL', 'value': buildUrl});
    let devices = await t.getDevicesByName(deviceType);
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
      await sleep(10000);
      testRun = await project.getTestRun(testRun);
    }
    let finishedAt = new Date(Date.now());
    debug(`Test Run ${testRun.id} finished at ${finishedAt}. Duration: ${(finishedAt - createdAt)/1000} seconds.`);
    debug(util.inspect(testRun));
  }

  async getDeviceSession(devices) {
    let session;
    for(let i = 0; i < devices.length; i++) {
      let device = devices[i];
      if (!device.online) continue;
      let maxRetries = 3;
      while (maxRetries-- > 0) {
        try {
          session = await this.client.startDeviceSession(device.id);
          return session;
        }
        catch (e) {
          debug(`Could not start device session for ${device.id}. Retries left: ${maxRetries}. ${e}`);
          // Noticed a delay between flashing and starting a device session
          await sleep(2000);
        }
      }
    }

    return session;
  }

  async releaseDevice(device) {
    await this.client.stopDeviceSession(device.session.id);
  }

  async getDevice(type, buildUrl) {
    let t = this.client;
    debug(`Attempting to get a ${type} device with ${buildUrl}`);
    let device, session;
    let maxRetries = 2;

    let labelGroup = await t.getLabelGroup(buildLabelGroupName);
    while (maxRetries-- > 0) {
      debug(`Attempting to get a ${type} device with ${buildUrl}. Retries left: ${maxRetries}`);
      // Find out if the label for the build url exists. Label won't exist if
      // build never was flashed before.
      let label = await t.getLabelInGroup(buildUrl, labelGroup);
      // if it does exist, find devices labeled with it
      if (label) {
        let devices = await t.getDevicesWithLabel(label);
        if (devices.length) {
          // If devices with label, try to get session
          session = await this.getDeviceSession(devices);
          // Return if there is a session, otherwise run flash project
          if(session) break;
        }
      }
      // If no label or can't create a device session, flash something and try again
      await this.flashDevice(type, buildUrl);
    }

    if(!session) return;

    // By default, this can take up to 150 seconds
    try {
      let adb = await t.getProxy('adb', session.id);
      let marionette = await t.getProxy('marionette', session.id);
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
      debug(e);
      await t.stopDeviceSession(session.id);
    }

    return device;
  }

  async getDevices() {
    let devices = await this.client.getDevices();
    return devices;
  }
}
