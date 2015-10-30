# Testdroid Proxy

Testdroid proxy is a server that interacts with the Testdroid Cloud API providing
common actions such as device aquisition (including flashing) and releasing device
sessions to be used with tasks running in docker-worker.

This allows tasks to request a device without needing to embed credentials or
follow a chain of steps for provisioning a device.

## Use
### Taskcluster
To use within a taskcluster task, enable the feature within the task payload:

```js
{
  "payload": {
    "features": {
      "testdroidProxy": true
    }
  }
}
```

This will link a container to your task that is made available as `testdroid`.
See below for requesting/releasing a device.

### Requesting device
Requests can be made for a device with a particular build.  This request will
attempt to find an existing device with the build and create a session.  If no
device exists with the build, an available device will be flashed using the build
provided at the build url.

```sh
CLOUD_HOST='testdroid'
DEVICE_TYPE='flame'
BUILD_URL='http://path/to/build/'
MEMORY='319'

deviceSession=`curl --request POST -H "Content-Type: application/json" -d '{"type":"$DEVICE_TYPE","memory":"$MEMORY","build":"$BUILD_URL"}' http://$CLOUD_HOST/device`

```

### Device Capabilities
Devices can be requested that meet a certain set of capabilities. Capabilities
are provided as a JSON payload.  When using within a taskcluster task, these can be
provided in task.payload.capabilities.devices.phone such as below.

```js
{
  "payload": {
    "capabilities": {
      "devices": {
        "phone": {
          "build": "http://path/to/build",
          "memory": "319",
          "type": "flame",
          "sims": "1",                        // optional
          "imei": "1234234623424",            // optional
          "phone_number": "555-555-5555"      // optional
        }
      }
    }
  }
}
```

### Releasing a device
The task should always make an attempt to release device sessions when finished.
If the device session could not be released, the testdroid-proxy container will attempt
to release the device before destroying the container.

```sh
CLOUD_HOST='testdroid'
curl --request POST http://$CLOUD_HOST/device/release
```

### Stand Alone
While the primary use of this server is to be used with tasks running within taskcluster,
the server can be started locally.  The container exposes port 80 which will need to be mapped
to a port locally.  If using Vagrant for docker, ensure that the port you map has a network mapping
within Vagrant.

```sh
CLOUD_URL=http://url/for/api
USERNAME=...
PASSWORD=...
docker run -p 8000:80 <image name> --cloud-url $CLOUD_URL --username USERNAME --password $PASSWORD

curl http://localhost:8000/

```
