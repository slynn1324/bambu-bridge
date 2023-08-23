const mqtt = require("mqtt");
const http = require("http");
  
BAMBUBRIDGE_MQTT_HOST=process.env.BAMBUBRIDGE_MQTT_HOST;
BAMBUBRIDGE_MQTT_PORT=process.env.BAMBUBRIDGE_MQTT_PORT || "1883";
BAMBUBRIDGE_MQTT_CLIENT_ID=process.env.BAMBUBRIDGE_MQTT_CLIENT_ID || "bambubridge-mqtt-client_" + new Date().getTime();
BAMBUBRIDGE_MQTT_USERNAME=process.env.BAMBUBRIDGE_MQTT_USERNAME;
BAMBUBRIDGE_MQTT_PASSWORD=process.env.BAMBUBRIDGE_MQTT_PASSWORD;
BAMBUBRIDGE_MQTT_PREFIX=process.env.BAMBUBRIDGE_MQTT_PREFIX || "bambubridge";
BAMBUBRIDGE_PRINTER_HOST=process.env.BAMBUBRIDGE_PRINTER_HOST;
BAMBUBRIDGE_PRINTER_SN=process.env.BAMBUBRIDGE_PRINTER_SN;
BAMBUBRIDGE_PRINTER_ACCESS_CODE=process.env.BAMBUBRIDGE_PRINTER_ACCESS_CODE;
BAMBUBRIDGE_HTTP_PORT=process.env.BAMBUBRIDGE_HTTP_PORT || 3000 ;  
BAMBUBRIDGE_VERBOSE=(process.env.BAMBUBRIDGE_VERBOSE || "n").toLowerCase() == "y";

if ( !BAMBUBRIDGE_MQTT_HOST ){
  console.log("Environment variable BAMBUBRIDGE_MQTT_HOST is required.");
  process.exit(1);
}
if ( !BAMBUBRIDGE_PRINTER_HOST ){
  console.log("Environment variable BAMBUBRIDGE_PRINTER_HOST is required.");
  process.exit(1);
}
if ( !BAMBUBRIDGE_PRINTER_SN ){
  console.log("Environment variable BAMBUBRIDGE_PRINTER_SN is required.");
  process.exit(1);
}
if ( !BAMBUBRIDGE_PRINTER_ACCESS_CODE ){
  console.log("Environment variable BAMBUBRIDGE_PRINTER_ACCESS_CODE is required.");
  process.exit(1);
}


console.log(`
Bambu Bridge

HTTP Port: ${BAMBUBRIDGE_HTTP_PORT}

MQTT Broker: 
  host: ${BAMBUBRIDGE_MQTT_HOST}
  port: ${BAMBUBRIDGE_MQTT_PORT}
  user: ${BAMBUBRIDGE_MQTT_USERNAME}
  pass: ${BAMBUBRIDGE_MQTT_PASSWORD}
  client id: ${BAMBUBRIDGE_MQTT_CLIENT_ID}
  topic prefix: ${BAMBUBRIDGE_MQTT_PREFIX}

Printer:
  host: ${BAMBUBRIDGE_PRINTER_HOST}
  sn: ${BAMBUBRIDGE_PRINTER_SN}
  access code: ${BAMBUBRIDGE_PRINTER_ACCESS_CODE}

Verbose: ${BAMBUBRIDGE_VERBOSE}



`);


const COMMANDS = {
  CHAMBER_LIGHT_ON : {
    "system": {"sequence_id": "0", "command": "ledctrl", "led_node": "chamber_light", "led_mode": "on",
             "led_on_time": 500, "led_off_time": 500, "loop_times": 0, "interval_time": 0}},
  CHAMBER_LIGHT_OFF : {
    "system": {"sequence_id": "0", "command": "ledctrl", "led_node": "chamber_light", "led_mode": "off",
             "led_on_time": 500, "led_off_time": 500, "loop_times": 0, "interval_time": 0}},
  PAUSE : {"print": {"sequence_id": "0", "command": "pause"}},
  RESUME : {"print": {"sequence_id": "0", "command": "resume"}},
  STOP : {"print": {"sequence_id": "0", "command": "stop"}},
  // CHAMBER_FAN_ON:  {"print": {"sequence_id": "0", "command": "gcode_line", "param": "M106 P3 100"}},
  // CHAMBER_FAN_OFF:  {"print": {"sequence_id": "0", "command": "gcode_line", "param": "M106 P3 0"}}
  // SEND_GCODE_TEMPLATE : {"print": {"sequence_id": "0", "command": "gcode_line", "param": ""}} // param = GCODE_EACH_LINE_SEPARATED_BY_\n
}

// function createGcodeCommand(gcode) {
//   let template = JSON.parse(JSON.serialize(COMMANDS.SEND_GCODE_TEMPLATE));
//   template.param = gcode;
//   return template; 
// }



// ###############################################################################################################
// Configure MQTT connection to the Broker
// ###############################################################################################################
const mqttClient = mqtt.connect(`mqtt://${BAMBUBRIDGE_MQTT_HOST}:${BAMBUBRIDGE_MQTT_PORT}`,{
  clientId: BAMBUBRIDGE_MQTT_CLIENT_ID,
  username: BAMBUBRIDGE_MQTT_USERNAME,
  password: BAMBUBRIDGE_MQTT_PASSWORD,
  will: {
    topic: `${BAMBUBRIDGE_MQTT_PREFIX}/status`,
    payload: "offline",
    retain: true
  }
});

mqttClient.on("error", (err) => {
  console.log("[mqtt] error:", err);
});

mqttClient.on("disconnect", (err) => {
  console.log("[mqtt] disconnect");
});

mqttClient.on("connect", (err) => {
  console.log("[mqtt] connect");
  mqttClient.publish(`${BAMBUBRIDGE_MQTT_PREFIX}/status`, "online", { retain: true });
  mqttClient.publish(`${BAMBUBRIDGE_MQTT_PREFIX}/${BAMBUBRIDGE_PRINTER_SN}/studio_status`, "offline", {retain: true});
  mqttClient.subscribe(`${BAMBUBRIDGE_MQTT_PREFIX}/${BAMBUBRIDGE_PRINTER_SN}/command`);
});

mqttClient.on("message", (topic, message) => {

  console.log("[mqtt] message topic=" + topic)
  let value = message.toString();

  // if we receive a command message, then issue the appropriate command to the printer via the bambuClient
  if ( topic == `${BAMBUBRIDGE_MQTT_PREFIX}/${BAMBUBRIDGE_PRINTER_SN}/command` ){
    if ( value === "stop" ){
      bambuClient.publish(`device/${BAMBUBRIDGE_PRINTER_SN}/request`, JSON.stringify(COMMANDS.STOP));
    } else if ( value === "pause" ){
      bambuClient.publish(`device/${BAMBUBRIDGE_PRINTER_SN}/request`, JSON.stringify(COMMANDS.PAUSE));
    } else if ( value === "resume" ){
      bambuClient.publish(`device/${BAMBUBRIDGE_PRINTER_SN}/request`, JSON.stringify(COMMANDS.RESUME));
    } else if ( value === "chamber_light_on" ){
      bambuClient.publish(`device/${BAMBUBRIDGE_PRINTER_SN}/request`, JSON.stringify(COMMANDS.CHAMBER_LIGHT_ON));
    } else if ( value === "chamber_light_off" ){
      bambuClient.publish(`device/${BAMBUBRIDGE_PRINTER_SN}/request`, JSON.stringify(COMMANDS.CHAMBER_LIGHT_OFF));
    } 
  }

});

// ###############################################################################################################
// Connect to the printer over MQTT
// We will only use this to issue commands to the printer.  Recent firmwares seem to block simultaneous 
// subscribers possibly impacting BambuStudio connections.  It doesn't appear to be an issue if you connect but 
// don't subscribe.  We can also track the connected state of MQTT to reflect the printer status.
// ###############################################################################################################
const bambuClient = mqtt.connect(`mqtts://${BAMBUBRIDGE_PRINTER_HOST}:8883`,{
    clientId: BAMBUBRIDGE_MQTT_CLIENT_ID,
    username: "bblp",
    password: BAMBUBRIDGE_PRINTER_ACCESS_CODE, 
    rejectUnauthorized: false,
    keepalive: 10,
    reconnectPeriod: 10000 // 10s instead of 1s
  });

// reflect bambu connection status on a broker topic
bambuClient.on("error", (err) => {
  console.log("[bambu] error", err);
  mqttClient.publish(`${BAMBUBRIDGE_MQTT_PREFIX}/${BAMBUBRIDGE_PRINTER_SN}/printer_status`, "offline", {retain: true});
});

bambuClient.on("disconnect", () => {
  console.log("[bambu] disconnect");
  mqttClient.publish(`${BAMBUBRIDGE_MQTT_PREFIX}/${BAMBUBRIDGE_PRINTER_SN}/printer_status`, "offline", {retain: true});
});

bambuClient.on("offline", () => {
  console.log("[bambu] offline");
  mqttClient.publish(`${BAMBUBRIDGE_MQTT_PREFIX}/${BAMBUBRIDGE_PRINTER_SN}/printer_status`, "offline", {retain: true});
});

bambuClient.on("reconnect", () => {
  // console.log("[bambu] reconnect");
})

bambuClient.on("connect", () => {
  console.log("[bambu] connect")
  mqttClient.publish(`${BAMBUBRIDGE_MQTT_PREFIX}/${BAMBUBRIDGE_PRINTER_SN}/printer_status`, "online", {retain: true});
// don't subscribe to mqtt directly from the printer, because it might lock out BambuStudio instances.
//  bambuClient.subscribe("device/01P00A361000034/report", (err) => {
//    console.log("[bambu] subscribed")

//    mqttClient.publish("bambubridge/status/01P00A361000034", "online", {retain: true});
	
//    bambuClient.publish("device/01P00A361000034/request", '{"info": {"sequence_id": "0", "command": "get_version"}}');
//    bambuClient.publish("device/01P00A361000034/request", '{"pushing": {"sequence_id": "0", "command": "pushall"}}');
//    console.log("[bambu] published pushall");
//  });
});


// ###############################################################################################################
// Process a JSON Message
// These are the report messages sent by the printer.  In our case, we're receiving them via webhook from 
// a forked and patched version of BambuStudio -> slynn1324/BambuStudio
// ###############################################################################################################
let inactiveTimer; 
function processMessage(message, devId, clientIp){

  if ( devId == BAMBUBRIDGE_PRINTER_SN ){
    let obj = JSON.parse(message.toString());

    if ( mqttClient.connected ){
      if ( obj.print ){

        for ( key in obj.print ){
          value = obj.print[key];

          if ( key == "wifi_signal" ){
            value = value.replace("dBm", "");
          }

          if ( typeof(value) === "number" ){
            value = "" + Math.round(value);
          } 

          if ( typeof(value) === "string" ){
            mqttClient.publish(`${BAMBUBRIDGE_MQTT_PREFIX}/${BAMBUBRIDGE_PRINTER_SN}/report/${key}`, "" + value, {retain: true});
          }
        }

        // flatten out the entries in the lights_report
        if ( obj.print.lights_report ){
          for ( const item of obj.print.lights_report ){
            mqttClient.publish(`${BAMBUBRIDGE_MQTT_PREFIX}/${BAMBUBRIDGE_PRINTER_SN}/report/light_${item.node}`, item.mode, {retain: true});
          }
        }

        mqttClient.publish(`${BAMBUBRIDGE_MQTT_PREFIX}/${BAMBUBRIDGE_PRINTER_SN}/studio_status`, "online", {retain: true});
        mqttClient.publish(`${BAMBUBRIDGE_MQTT_PREFIX}/${BAMBUBRIDGE_PRINTER_SN}/last_update`, new Date().toISOString(), {retain: true});
        mqttClient.publish(`${BAMBUBRIDGE_MQTT_PREFIX}/${BAMBUBRIDGE_PRINTER_SN}/last_update_ip`, clientIp, {retain: true});
        
        // setup a timer to report the studio is offline if we don't get a message for 10s.
        clearTimeout(inactiveTimer);
        inactiveTimer = setTimeout(() => {
          mqttClient.publish(`${BAMBUBRIDGE_MQTT_PREFIX}/${BAMBUBRIDGE_PRINTER_SN}/studio_status`, "offline", {retain: true});
        }, 10000 );
      }
    }

  } else {
    console.log(`ignoring request for wrong SN: ${devId} != ${BAMBUBRIDGE_PRINTER_SN}`);
  }
}



// ###############################################################################################################
// Setup an HTTP Server / Listener
// Handle POST requests, delegating to processMessage()
// ###############################################################################################################
const httpServer = http.createServer((req,resp) => {
	
	if ( req.method == "GET" ){
		resp.end("bambu-bridge");
	}	

	else if ( req.method == "POST" ){

		let clientIp = req.headers['x-forwarded-for']?.split(',').shift() || req.socket?.remoteAddress
		clientIp = clientIp.split(":").pop();

		let chunks = [];
	
		req.on("data", chunk => {
			chunks.push(chunk);
		});

		req.on("end", () => {
			const body = Buffer.concat(chunks).toString();
			const devId = req.headers['dev_id'];
      if ( BAMBUBRIDGE_VERBOSE ){
			  console.log(`req for dev_id=${devId}`);
      }
			try {
				JSON.parse(body);
        if ( BAMBUBRIDGE_VERBOSE ){
				  console.log(body);
        }
				processMessage(body, devId, clientIp);
				resp.end("ok");
			} catch (e) {
				console.log("ERROR - invalid JSON: ", body);
        console.log(e);
				resp.statusCode = 400;
				resp.end("invalid json"); 
			}
		});
	}
});

httpServer.listen(BAMBUBRIDGE_HTTP_PORT, () => {
	console.log(`http listening on port ${BAMBUBRIDGE_HTTP_PORT}`);
});

process.on("SIGTERM", () => {
	process.exit(0);
});
