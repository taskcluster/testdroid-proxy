require('6to5/polyfill');
import { version } from '../../package.json';
import Debug from 'debug';
import util from 'util';
import Hapi from 'hapi';
import Joi from 'joi';
import { ArgumentParser } from 'argparse';
import Testdroid from 'testdroid-client';
import DeviceHandler from '../handlers/device';
import sleep from '../util';

let debug = Debug('testdroid-proxy:server');

let parser = new ArgumentParser({
  version: version,
  addHelp: true
});

parser.addArgument(
  ['-c', '--cloud-url'],
  {
    help: 'Cloud URL for Testdroid',
    required: true
  }
);

parser.addArgument(
  ['-u', '--username'],
  {
    help: 'Username for Testdroid api',
    required: true
  }
);

parser.addArgument(
  ['-p', '--password'],
  {
    help: 'Password for Testd`roid user',
    required: true
  }
);

let args = parser.parseArgs();

let server = new Hapi.Server();
server.connection({ port: 80 });

server.route([
  {
    method: 'GET',
    path: '/',
    handler: (request, reply) => { reply('Server running'); }
  },
  {
    method: 'GET',
    path: '/devices',
    handler: async (request, reply) => {
      debug(`Requesting: ${request.url.path}`);
      let devices = await server.app.deviceHandler.getDevices();
      reply(devices);
    }
  },
  {
    method: 'POST',
    path: '/device',
    handler: async (request, reply) => {
      debug(`Requesting: ${request.url.path}`);
      try {
        let device = await server.app.deviceHandler.getDevice(
          request.payload, 2
        );

        if (!device) {
          throw new Error("Couldn't create device session");
        }
        server.app.device = device;
        reply(device);
      }
      catch (e) {
        debug(e);
        reply(e).status(500);
      }
    },
    config: {
      validate: {
        payload: {
          type: Joi.string().required(),
          build: Joi.string().required(),
          memory: Joi.string().required(),
          sims: Joi.string().optional(),
          imei: Joi.string().optional(),
          phone_number: Joi.string().optional()
        }
      },
      timeout: {
        // Keep connection open for up to 10 minutes while flashing
        // XXX: This is a hack, in the future should make available a status
        // endpoint to query instead of keeping this open.
        server: 10*60*1000,
        socket: 11*60*1000
      }
    }
  },
  {
    method: 'POST',
    path: '/device/release',
    handler: async (request, reply) => {
      debug(`Requesting: ${request.url.path}`);
      if (server.app.device) {
        await server.app.deviceHandler.releaseDevice(server.app.device);
        server.app.device = undefined;
        reply('Device released');
      }
      reply('No device session to release').status(400);
    }
  },
  {
    method: 'GET',
    path: '/device/properties',
    handler: async (request, reply) => {
      debug(`Requesting: ${request.url.path}`);
      let properties = await server.app.deviceHandler.getDeviceProperties(server.app.device.device);
      reply(properties).status(200);
    }
  }

]);

server.start(() => {
  console.log('server started');
  server.app.testdroid = new Testdroid(args.cloud_url, args.username, args.password);
  server.app.deviceHandler = new DeviceHandler(server.app.testdroid);
});

