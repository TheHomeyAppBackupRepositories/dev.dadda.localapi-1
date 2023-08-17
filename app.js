"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const homey_1 = __importDefault(require("homey"));
const http_1 = __importDefault(require("http"));
const events_1 = require("events");
class LocalApi extends homey_1.default.App {
    constructor() {
        super(...arguments);
        this.localApiEvent = new events_1.EventEmitter();
        this.requestReceivedArgs = [];
        /**
         * Run listener for the response with 200 action Flow Card
         * @param args The arguments passed to the action card
         * @param state The state of the action card
         */
        this.responseWithOkRunListener = async (args, state) => {
            try {
                this.localApiEvent.emit('responseAction', { status: 'ok' });
            }
            catch (e) {
                this.error(e);
            }
            return true;
        };
        /**
         * Run listener for the response with action Flow Card
         * @param args The arguments passed to the action card
         * @param state The state of the action card
         */
        this.responseWithActionRunListener = async (args, state) => {
            let parsedBody = {};
            try {
                parsedBody = JSON.parse(args.body || '{}');
            }
            catch (e) {
                parsedBody = { status: 'error', message: 'Invalid JSON' };
            }
            try {
                this.localApiEvent.emit('responseAction', parsedBody);
            }
            catch (e) {
                this.error(e);
            }
            return true;
        };
        /**
         * Run listener for the request received Trigger Flow Card
         * @param args The arguments passed to the trigger card
         * @param state The state of the trigger card
         */
        this.requestReceivedTriggerRunListener = async (args, state) => { var _a; return (args.url === state.url && args.method === ((_a = state.method) === null || _a === void 0 ? void 0 : _a.toLowerCase())); };
    }
    /**
     * Retrieve the CORS config from the settings
     */
    retrieveCorsConfig() {
        const corsAcao = this.homey.settings.get('corsAcao') || '*';
        if (corsAcao === '') {
            return '*';
        }
        return corsAcao;
    }
    /**
     * Retrieve CORS active status from the settings
     */
    isCorsActive() {
        const corsStatus = this.homey.settings.get('corsStatus') || 'false';
        return corsStatus === 'true';
    }
    /**
     * Check if the request is authorized to be handled by the Local API
     * @param req The node http request object
     */
    isRouteAuthorized(req) {
        return this.requestReceivedArgs.find((arg) => arg.url === req.url) !== undefined;
    }
    /**
     * Check if the request is authorized to be handled by the Local API
     * @param url The url to check
     * @param method The method to check
     */
    isRouteAndMethodAuthorized(url, method) {
        return this.requestReceivedArgs.find((arg) => arg.url === url && arg.method === method.toLowerCase()) !== undefined;
    }
    /**
     * onInit is called when the app is initialized.
     */
    async onInit() {
        // Define Trigger Requests
        const requestReceivedTrigger = this.homey.flow.getTriggerCard('local-api-request-received');
        // Define Actions Responses
        const responseWithAction = this.homey.flow.getActionCard('local-api-response-with');
        const responseWithOk = this.homey.flow.getActionCard('local-api-respond-with-200');
        // Retrieve Settings and initialize Local API App
        const serverPort = this.homey.settings.get('serverPort') || 3000;
        this.requestReceivedArgs = await requestReceivedTrigger.getArgumentValues() || [];
        this.localApiEvent.on('warning', (e) => this.error('warning', e.stack));
        this.localApiEvent.on('uncaughtException', (e) => this.error('uncaughtException', e.stack));
        requestReceivedTrigger.registerRunListener(this.requestReceivedTriggerRunListener);
        responseWithAction.registerRunListener(this.responseWithActionRunListener);
        responseWithOk.registerRunListener(this.responseWithOkRunListener);
        requestReceivedTrigger.on('update', async () => {
            this.log('LocalAPI: Found updated trigger, updating args... ');
            this.requestReceivedArgs = await requestReceivedTrigger.getArgumentValues();
            this.log('LocalAPI: args updated');
        });
        this.log('LocalAPI has been initialized');
        // Create a http server instance that can be used to listening on user defined port (or 3000, default).
        http_1.default.createServer(async (req, res) => {
            var _a, _b, _c, _d, _e;
            const corsAcao = this.retrieveCorsConfig();
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Access-Control-Allow-Origin', corsAcao);
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Origin, Accept, Content-Type, Authorization, Content-Length, X-Requested-With, XMLHttpRequest');
            if (this.isRouteAuthorized(req) && req.method === 'OPTIONS' && this.isCorsActive()) {
                // Handle CORS preflight request
                res.writeHead(200);
            }
            else if (this.isRouteAndMethodAuthorized((_a = req.url) !== null && _a !== void 0 ? _a : '/', (_b = req.method) !== null && _b !== void 0 ? _b : '')) {
                // Handle request
                try {
                    requestReceivedTrigger.trigger({}, { url: (_c = req.url) !== null && _c !== void 0 ? _c : '/', method: (_e = (_d = req.method) === null || _d === void 0 ? void 0 : _d.toLowerCase()) !== null && _e !== void 0 ? _e : '' });
                    const argVal = await new Promise((resolve) => {
                        this.localApiEvent.once('responseAction', (body) => {
                            resolve(body);
                        });
                    });
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.write(JSON.stringify({
                        status: 'success', url: req.url, method: req.method, data: argVal,
                    }));
                }
                catch (e) {
                    this.error(e);
                }
            }
            else {
                // Handle 404
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.write(JSON.stringify({
                    status: 'not-found',
                }));
            }
            // Send end of response
            res.end();
            // Destroy the response, the request and the listener to free up memory
            this.localApiEvent.removeAllListeners('responseAction');
            res.destroy();
            req.destroy();
        }).listen(serverPort, () => {
            this.log(`LocalAPI server started at port ${serverPort}`);
        }).on('error', (e) => {
            // Handle server error
            if (e instanceof Error) {
                if (e.message.includes('EADDRINUSE') || e.message.includes('EACCES')) {
                    this.error(`LocalAPI server error: port ${serverPort} already in use`);
                }
                else {
                    this.error(`LocalAPI server error: ${e.message}`);
                }
            }
            else {
                this.error('LocalAPI server error: unknown error');
            }
        });
    }
}
module.exports = LocalApi;
