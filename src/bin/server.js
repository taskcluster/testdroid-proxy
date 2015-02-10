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
      debug('/devices');
      let devices = await server.app.deviceHandler.getDevices();
      reply(devices);
    }
  },
  {
    method: 'GET',
    path: '/device',
    handler: async (request, reply) => {
      debug(request.url.path);
      try {
        let device = await server.app.deviceHandler.getDevice(request.query.type, request.query.buildUrl);
        if (!device) {
          throw new Error("Couldn't create device session");
        }
        server.app.device = device
        reply(device)
      }
      catch (e) {
        debug(e);
        reply(e).status(500);
      }
    },
    config: {
      validate: {
        query: {
          //TODO Add better validation https://gist.github.com/dperini/729294
          type: Joi.string().required(),
          buildUrl: Joi.string().required()
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
      debug(request.url.path);
      if (server.app.device) {
        await server.app.deviceHandler.releaseDevice(server.app.device);
        server.app.device = undefined;
        reply('Device released');
      }
      reply('No device session to release').status(400);
    }
  }

]);

server.start(() => {
  console.log('server started');
  server.app.testdroid = new Testdroid(args.cloud_url, args.username, args.password);
  server.app.deviceHandler = new DeviceHandler(server.app.testdroid);
});

