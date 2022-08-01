// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
import { delay } from "../async/mod.ts";
/** Thrown by Server after it has been closed. */ const ERROR_SERVER_CLOSED = "Server closed";
/** Default port for serving HTTP. */ const HTTP_PORT = 80;
/** Default port for serving HTTPS. */ const HTTPS_PORT = 443;
/** Initial backoff delay of 5ms following a temporary accept failure. */ const INITIAL_ACCEPT_BACKOFF_DELAY = 5;
/** Max backoff delay of 1s following a temporary accept failure. */ const MAX_ACCEPT_BACKOFF_DELAY = 1000;
/** Used to construct an HTTP server. */ export class Server {
    #port;
    #host;
    #handler;
    #closed = false;
    #listeners = new Set();
    #httpConnections = new Set();
    #onError;
    /**
   * Constructs a new HTTP Server instance.
   *
   * ```ts
   * import { Server } from "https://deno.land/std@$STD_VERSION/http/server.ts";
   *
   * const port = 4505;
   * const handler = (request: Request) => {
   *   const body = `Your user-agent is:\n\n${request.headers.get(
   *    "user-agent",
   *   ) ?? "Unknown"}`;
   *
   *   return new Response(body, { status: 200 });
   * };
   *
   * const server = new Server({ port, handler });
   * ```
   *
   * @param serverInit Options for running an HTTP server.
   */ constructor(serverInit){
        this.#port = serverInit.port;
        this.#host = serverInit.hostname;
        this.#handler = serverInit.handler;
        this.#onError = serverInit.onError ?? function(error) {
            console.error(error);
            return new Response("Internal Server Error", {
                status: 500
            });
        };
    }
    /**
   * Accept incoming connections on the given listener, and handle requests on
   * these connections with the given handler.
   *
   * HTTP/2 support is only enabled if the provided Deno.Listener returns TLS
   * connections and was configured with "h2" in the ALPN protocols.
   *
   * Throws a server closed error if called after the server has been closed.
   *
   * Will always close the created listener.
   *
   * ```ts
   * import { Server } from "https://deno.land/std@$STD_VERSION/http/server.ts";
   *
   * const handler = (request: Request) => {
   *   const body = `Your user-agent is:\n\n${request.headers.get(
   *    "user-agent",
   *   ) ?? "Unknown"}`;
   *
   *   return new Response(body, { status: 200 });
   * };
   *
   * const server = new Server({ handler });
   * const listener = Deno.listen({ port: 4505 });
   *
   * console.log("server listening on http://localhost:4505");
   *
   * await server.serve(listener);
   * ```
   *
   * @param listener The listener to accept connections from.
   */ async serve(listener) {
        if (this.#closed) {
            throw new Deno.errors.Http(ERROR_SERVER_CLOSED);
        }
        this.#trackListener(listener);
        try {
            return await this.#accept(listener);
        } finally{
            this.#untrackListener(listener);
            try {
                listener.close();
            } catch  {
            // Listener has already been closed.
            }
        }
    }
    /**
   * Create a listener on the server, accept incoming connections, and handle
   * requests on these connections with the given handler.
   *
   * If the server was constructed without a specified port, 80 is used.
   *
   * If the server was constructed with the hostname omitted from the options, the
   * non-routable meta-address `0.0.0.0` is used.
   *
   * Throws a server closed error if the server has been closed.
   *
   * ```ts
   * import { Server } from "https://deno.land/std@$STD_VERSION/http/server.ts";
   *
   * const port = 4505;
   * const handler = (request: Request) => {
   *   const body = `Your user-agent is:\n\n${request.headers.get(
   *    "user-agent",
   *   ) ?? "Unknown"}`;
   *
   *   return new Response(body, { status: 200 });
   * };
   *
   * const server = new Server({ port, handler });
   *
   * console.log("server listening on http://localhost:4505");
   *
   * await server.listenAndServe();
   * ```
   */ async listenAndServe() {
        if (this.#closed) {
            throw new Deno.errors.Http(ERROR_SERVER_CLOSED);
        }
        const listener = Deno.listen({
            port: this.#port ?? HTTP_PORT,
            hostname: this.#host ?? "0.0.0.0",
            transport: "tcp"
        });
        return await this.serve(listener);
    }
    /**
   * Create a listener on the server, accept incoming connections, upgrade them
   * to TLS, and handle requests on these connections with the given handler.
   *
   * If the server was constructed without a specified port, 443 is used.
   *
   * If the server was constructed with the hostname omitted from the options, the
   * non-routable meta-address `0.0.0.0` is used.
   *
   * Throws a server closed error if the server has been closed.
   *
   * ```ts
   * import { Server } from "https://deno.land/std@$STD_VERSION/http/server.ts";
   *
   * const port = 4505;
   * const handler = (request: Request) => {
   *   const body = `Your user-agent is:\n\n${request.headers.get(
   *    "user-agent",
   *   ) ?? "Unknown"}`;
   *
   *   return new Response(body, { status: 200 });
   * };
   *
   * const server = new Server({ port, handler });
   *
   * const certFile = "/path/to/certFile.crt";
   * const keyFile = "/path/to/keyFile.key";
   *
   * console.log("server listening on https://localhost:4505");
   *
   * await server.listenAndServeTls(certFile, keyFile);
   * ```
   *
   * @param certFile The path to the file containing the TLS certificate.
   * @param keyFile The path to the file containing the TLS private key.
   */ async listenAndServeTls(certFile, keyFile) {
        if (this.#closed) {
            throw new Deno.errors.Http(ERROR_SERVER_CLOSED);
        }
        const listener = Deno.listenTls({
            port: this.#port ?? HTTPS_PORT,
            hostname: this.#host ?? "0.0.0.0",
            certFile,
            keyFile,
            transport: "tcp"
        });
        return await this.serve(listener);
    }
    /**
   * Immediately close the server listeners and associated HTTP connections.
   *
   * Throws a server closed error if called after the server has been closed.
   */ close() {
        if (this.#closed) {
            throw new Deno.errors.Http(ERROR_SERVER_CLOSED);
        }
        this.#closed = true;
        for (const listener of this.#listeners){
            try {
                listener.close();
            } catch  {
            // Listener has already been closed.
            }
        }
        this.#listeners.clear();
        for (const httpConn of this.#httpConnections){
            this.#closeHttpConn(httpConn);
        }
        this.#httpConnections.clear();
    }
    /** Get whether the server is closed. */ get closed() {
        return this.#closed;
    }
    /** Get the list of network addresses the server is listening on. */ get addrs() {
        return Array.from(this.#listeners).map((listener)=>listener.addr
        );
    }
    /**
   * Responds to an HTTP request.
   *
   * @param requestEvent The HTTP request to respond to.
   * @param httpCon The HTTP connection to yield requests from.
   * @param connInfo Information about the underlying connection.
   */ async #respond(requestEvent, httpConn, connInfo) {
        let response;
        try {
            // Handle the request event, generating a response.
            response = await this.#handler(requestEvent.request, connInfo);
        } catch (error) {
            // Invoke onError handler when request handler throws.
            response = await this.#onError(error);
        }
        try {
            // Send the response.
            await requestEvent.respondWith(response);
        } catch  {
            // respondWith() fails when the connection has already been closed, or there is some
            // other error with responding on this connection that prompts us to
            // close it and open a new connection.
            return this.#closeHttpConn(httpConn);
        }
    }
    /**
   * Serves all HTTP requests on a single connection.
   *
   * @param httpConn The HTTP connection to yield requests from.
   * @param connInfo Information about the underlying connection.
   */ async #serveHttp(httpConn1, connInfo1) {
        while(!this.#closed){
            let requestEvent;
            try {
                // Yield the new HTTP request on the connection.
                requestEvent = await httpConn1.nextRequest();
            } catch  {
                break;
            }
            if (requestEvent === null) {
                break;
            }
            // Respond to the request. Note we do not await this async method to
            // allow the connection to handle multiple requests in the case of h2.
            this.#respond(requestEvent, httpConn1, connInfo1);
        }
        this.#closeHttpConn(httpConn1);
    }
    /**
   * Accepts all connections on a single network listener.
   *
   * @param listener The listener to accept connections from.
   */ async #accept(listener) {
        let acceptBackoffDelay;
        while(!this.#closed){
            let conn;
            try {
                // Wait for a new connection.
                conn = await listener.accept();
            } catch (error) {
                if (// The listener is closed.
                error instanceof Deno.errors.BadResource || // TLS handshake errors.
                error instanceof Deno.errors.InvalidData || error instanceof Deno.errors.UnexpectedEof || error instanceof Deno.errors.ConnectionReset || error instanceof Deno.errors.NotConnected) {
                    // Backoff after transient errors to allow time for the system to
                    // recover, and avoid blocking up the event loop with a continuously
                    // running loop.
                    if (!acceptBackoffDelay) {
                        acceptBackoffDelay = INITIAL_ACCEPT_BACKOFF_DELAY;
                    } else {
                        acceptBackoffDelay *= 2;
                    }
                    if (acceptBackoffDelay >= MAX_ACCEPT_BACKOFF_DELAY) {
                        acceptBackoffDelay = MAX_ACCEPT_BACKOFF_DELAY;
                    }
                    await delay(acceptBackoffDelay);
                    continue;
                }
                throw error;
            }
            acceptBackoffDelay = undefined;
            // "Upgrade" the network connection into an HTTP connection.
            let httpConn;
            try {
                httpConn = Deno.serveHttp(conn);
            } catch  {
                continue;
            }
            // Closing the underlying listener will not close HTTP connections, so we
            // track for closure upon server close.
            this.#trackHttpConnection(httpConn);
            const connInfo = {
                localAddr: conn.localAddr,
                remoteAddr: conn.remoteAddr
            };
            // Serve the requests that arrive on the just-accepted connection. Note
            // we do not await this async method to allow the server to accept new
            // connections.
            this.#serveHttp(httpConn, connInfo);
        }
    }
    /**
   * Untracks and closes an HTTP connection.
   *
   * @param httpConn The HTTP connection to close.
   */  #closeHttpConn(httpConn2) {
        this.#untrackHttpConnection(httpConn2);
        try {
            httpConn2.close();
        } catch  {
        // Connection has already been closed.
        }
    }
    /**
   * Adds the listener to the internal tracking list.
   *
   * @param listener Listener to track.
   */  #trackListener(listener1) {
        this.#listeners.add(listener1);
    }
    /**
   * Removes the listener from the internal tracking list.
   *
   * @param listener Listener to untrack.
   */  #untrackListener(listener2) {
        this.#listeners.delete(listener2);
    }
    /**
   * Adds the HTTP connection to the internal tracking list.
   *
   * @param httpConn HTTP connection to track.
   */  #trackHttpConnection(httpConn3) {
        this.#httpConnections.add(httpConn3);
    }
    /**
   * Removes the HTTP connection from the internal tracking list.
   *
   * @param httpConn HTTP connection to untrack.
   */  #untrackHttpConnection(httpConn4) {
        this.#httpConnections.delete(httpConn4);
    }
}
/**
 * Constructs a server, accepts incoming connections on the given listener, and
 * handles requests on these connections with the given handler.
 *
 * ```ts
 * import { serveListener } from "https://deno.land/std@$STD_VERSION/http/server.ts";
 *
 * const listener = Deno.listen({ port: 4505 });
 *
 * console.log("server listening on http://localhost:4505");
 *
 * await serveListener(listener, (request) => {
 *   const body = `Your user-agent is:\n\n${request.headers.get(
 *     "user-agent",
 *   ) ?? "Unknown"}`;
 *
 *   return new Response(body, { status: 200 });
 * });
 * ```
 *
 * @param listener The listener to accept connections from.
 * @param handler The handler for individual HTTP requests.
 * @param options Optional serve options.
 */ export async function serveListener(listener3, handler, options) {
    const server = new Server({
        handler,
        onError: options?.onError
    });
    options?.signal?.addEventListener("abort", ()=>server.close()
    , {
        once: true
    });
    return await server.serve(listener3);
}
function hostnameForDisplay(hostname) {
    // If the hostname is "0.0.0.0", we display "localhost" in console
    // because browsers in Windows don't resolve "0.0.0.0".
    // See the discussion in https://github.com/denoland/deno_std/issues/1165
    return hostname === "0.0.0.0" ? "localhost" : hostname;
}
/** Serves HTTP requests with the given handler.
 *
 * You can specify an object with a port and hostname option, which is the
 * address to listen on. The default is port 8000 on hostname "0.0.0.0".
 *
 * The below example serves with the port 8000.
 *
 * ```ts
 * import { serve } from "https://deno.land/std@$STD_VERSION/http/server.ts";
 * serve((_req) => new Response("Hello, world"));
 * ```
 *
 * You can change the listening address by the `hostname` and `port` options.
 * The below example serves with the port 3000.
 *
 * ```ts
 * import { serve } from "https://deno.land/std@$STD_VERSION/http/server.ts";
 * serve((_req) => new Response("Hello, world"), { port: 3000 });
 * ```
 *
 * `serve` function prints the message `Listening on http://<hostname>:<port>/`
 * on start-up by default. If you like to change this message, you can specify
 * `onListen` option to override it.
 *
 * ```ts
 * import { serve } from "https://deno.land/std@$STD_VERSION/http/server.ts";
 * serve((_req) => new Response("Hello, world"), {
 *   onListen({ port, hostname }) {
 *     console.log(`Server started at http://${hostname}:${port}`);
 *     // ... more info specific to your server ..
 *   },
 * });
 * ```
 *
 * You can also specify `undefined` or `null` to stop the logging behavior.
 *
 * ```ts
 * import { serve } from "https://deno.land/std@$STD_VERSION/http/server.ts";
 * serve((_req) => new Response("Hello, world"), { onListen: undefined });
 * ```
 *
 * @param handler The handler for individual HTTP requests.
 * @param options The options. See `ServeInit` documentation for details.
 */ export async function serve(handler, options = {}) {
    const port = options.port ?? 8000;
    const hostname = options.hostname ?? "0.0.0.0";
    const server = new Server({
        port,
        hostname,
        handler,
        onError: options.onError
    });
    options?.signal?.addEventListener("abort", ()=>server.close()
    , {
        once: true
    });
    const s = server.listenAndServe();
    if ("onListen" in options) {
        options.onListen?.({
            port,
            hostname
        });
    } else {
        console.log(`Listening on http://${hostnameForDisplay(hostname)}:${port}/`);
    }
    return await s;
}
/** Serves HTTPS requests with the given handler.
 *
 * You must specify `keyFile` and `certFile` options.
 *
 * You can specify an object with a port and hostname option, which is the
 * address to listen on. The default is port 8443 on hostname "0.0.0.0".
 *
 * The below example serves with the default port 8443.
 *
 * ```ts
 * import { serveTls } from "https://deno.land/std@$STD_VERSION/http/server.ts";
 * const certFile = "/path/to/certFile.crt";
 * const keyFile = "/path/to/keyFile.key";
 * serveTls((_req) => new Response("Hello, world"), { certFile, keyFile });
 * ```
 *
 * `serveTls` function prints the message `Listening on https://<hostname>:<port>/`
 * on start-up by default. If you like to change this message, you can specify
 * `onListen` option to override it.
 *
 * ```ts
 * import { serveTls } from "https://deno.land/std@$STD_VERSION/http/server.ts";
 * const certFile = "/path/to/certFile.crt";
 * const keyFile = "/path/to/keyFile.key";
 * serveTls((_req) => new Response("Hello, world"), {
 *   certFile,
 *   keyFile,
 *   onListen({ port, hostname }) {
 *     console.log(`Server started at https://${hostname}:${port}`);
 *     // ... more info specific to your server ..
 *   },
 * });
 * ```
 *
 * You can also specify `undefined` or `null` to stop the logging behavior.
 *
 * ```ts
 * import { serveTls } from "https://deno.land/std@$STD_VERSION/http/server.ts";
 * const certFile = "/path/to/certFile.crt";
 * const keyFile = "/path/to/keyFile.key";
 * serveTls((_req) => new Response("Hello, world"), {
 *   certFile,
 *   keyFile,
 *   onListen: undefined,
 * });
 * ```
 *
 * @param handler The handler for individual HTTPS requests.
 * @param options The options. See `ServeTlsInit` documentation for details.
 * @returns
 */ export async function serveTls(handler, options) {
    if (!options.keyFile) {
        throw new Error("TLS config is given, but 'keyFile' is missing.");
    }
    if (!options.certFile) {
        throw new Error("TLS config is given, but 'certFile' is missing.");
    }
    const port = options.port ?? 8443;
    const hostname = options.hostname ?? "0.0.0.0";
    const server = new Server({
        port,
        hostname,
        handler,
        onError: options.onError
    });
    options?.signal?.addEventListener("abort", ()=>server.close()
    , {
        once: true
    });
    const s = server.listenAndServeTls(options.certFile, options.keyFile);
    if ("onListen" in options) {
        options.onListen?.({
            port,
            hostname
        });
    } else {
        console.log(`Listening on https://${hostnameForDisplay(hostname)}:${port}/`);
    }
    return await s;
}
/**
 * @deprecated Use `serve` instead.
 *
 * Constructs a server, creates a listener on the given address, accepts
 * incoming connections, and handles requests on these connections with the
 * given handler.
 *
 * If the port is omitted from the ListenOptions, 80 is used.
 *
 * If the host is omitted from the ListenOptions, the non-routable meta-address
 * `0.0.0.0` is used.
 *
 * ```ts
 * import { listenAndServe } from "https://deno.land/std@$STD_VERSION/http/server.ts";
 *
 * const port = 4505;
 *
 * console.log("server listening on http://localhost:4505");
 *
 * await listenAndServe({ port }, (request) => {
 *   const body = `Your user-agent is:\n\n${request.headers.get(
 *     "user-agent",
 *   ) ?? "Unknown"}`;
 *
 *   return new Response(body, { status: 200 });
 * });
 * ```
 *
 * @param config The Deno.ListenOptions to specify the hostname and port.
 * @param handler The handler for individual HTTP requests.
 * @param options Optional serve options.
 */ export async function listenAndServe(config, handler, options) {
    const server = new Server({
        ...config,
        handler
    });
    options?.signal?.addEventListener("abort", ()=>server.close()
    , {
        once: true
    });
    return await server.listenAndServe();
}
/**
 * @deprecated Use `serveTls` instead.
 *
 * Constructs a server, creates a listener on the given address, accepts
 * incoming connections, upgrades them to TLS, and handles requests on these
 * connections with the given handler.
 *
 * If the port is omitted from the ListenOptions, port 443 is used.
 *
 * If the host is omitted from the ListenOptions, the non-routable meta-address
 * `0.0.0.0` is used.
 *
 * ```ts
 * import { listenAndServeTls } from "https://deno.land/std@$STD_VERSION/http/server.ts";
 *
 * const port = 4505;
 * const certFile = "/path/to/certFile.crt";
 * const keyFile = "/path/to/keyFile.key";
 *
 * console.log("server listening on http://localhost:4505");
 *
 * await listenAndServeTls({ port }, certFile, keyFile, (request) => {
 *   const body = `Your user-agent is:\n\n${request.headers.get(
 *     "user-agent",
 *   ) ?? "Unknown"}`;
 *
 *   return new Response(body, { status: 200 });
 * });
 * ```
 *
 * @param config The Deno.ListenOptions to specify the hostname and port.
 * @param certFile The path to the file containing the TLS certificate.
 * @param keyFile The path to the file containing the TLS private key.
 * @param handler The handler for individual HTTP requests.
 * @param options Optional serve options.
 */ export async function listenAndServeTls(config, certFile, keyFile, handler, options) {
    const server = new Server({
        ...config,
        handler
    });
    options?.signal?.addEventListener("abort", ()=>server.close()
    , {
        once: true
    });
    return await server.listenAndServeTls(certFile, keyFile);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIiJdLCJzb3VyY2VzQ29udGVudCI6WyIvLyBDb3B5cmlnaHQgMjAxOC0yMDIyIHRoZSBEZW5vIGF1dGhvcnMuIEFsbCByaWdodHMgcmVzZXJ2ZWQuIE1JVCBsaWNlbnNlLlxuaW1wb3J0IHsgZGVsYXkgfSBmcm9tIFwiLi4vYXN5bmMvbW9kLnRzXCI7XG5cbi8qKiBUaHJvd24gYnkgU2VydmVyIGFmdGVyIGl0IGhhcyBiZWVuIGNsb3NlZC4gKi9cbmNvbnN0IEVSUk9SX1NFUlZFUl9DTE9TRUQgPSBcIlNlcnZlciBjbG9zZWRcIjtcblxuLyoqIERlZmF1bHQgcG9ydCBmb3Igc2VydmluZyBIVFRQLiAqL1xuY29uc3QgSFRUUF9QT1JUID0gODA7XG5cbi8qKiBEZWZhdWx0IHBvcnQgZm9yIHNlcnZpbmcgSFRUUFMuICovXG5jb25zdCBIVFRQU19QT1JUID0gNDQzO1xuXG4vKiogSW5pdGlhbCBiYWNrb2ZmIGRlbGF5IG9mIDVtcyBmb2xsb3dpbmcgYSB0ZW1wb3JhcnkgYWNjZXB0IGZhaWx1cmUuICovXG5jb25zdCBJTklUSUFMX0FDQ0VQVF9CQUNLT0ZGX0RFTEFZID0gNTtcblxuLyoqIE1heCBiYWNrb2ZmIGRlbGF5IG9mIDFzIGZvbGxvd2luZyBhIHRlbXBvcmFyeSBhY2NlcHQgZmFpbHVyZS4gKi9cbmNvbnN0IE1BWF9BQ0NFUFRfQkFDS09GRl9ERUxBWSA9IDEwMDA7XG5cbi8qKiBJbmZvcm1hdGlvbiBhYm91dCB0aGUgY29ubmVjdGlvbiBhIHJlcXVlc3QgYXJyaXZlZCBvbi4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQ29ubkluZm8ge1xuICAvKiogVGhlIGxvY2FsIGFkZHJlc3Mgb2YgdGhlIGNvbm5lY3Rpb24uICovXG4gIHJlYWRvbmx5IGxvY2FsQWRkcjogRGVuby5BZGRyO1xuICAvKiogVGhlIHJlbW90ZSBhZGRyZXNzIG9mIHRoZSBjb25uZWN0aW9uLiAqL1xuICByZWFkb25seSByZW1vdGVBZGRyOiBEZW5vLkFkZHI7XG59XG5cbi8qKlxuICogQSBoYW5kbGVyIGZvciBIVFRQIHJlcXVlc3RzLiBDb25zdW1lcyBhIHJlcXVlc3QgYW5kIGNvbm5lY3Rpb24gaW5mb3JtYXRpb25cbiAqIGFuZCByZXR1cm5zIGEgcmVzcG9uc2UuXG4gKlxuICogSWYgYSBoYW5kbGVyIHRocm93cywgdGhlIHNlcnZlciBjYWxsaW5nIHRoZSBoYW5kbGVyIHdpbGwgYXNzdW1lIHRoZSBpbXBhY3RcbiAqIG9mIHRoZSBlcnJvciBpcyBpc29sYXRlZCB0byB0aGUgaW5kaXZpZHVhbCByZXF1ZXN0LiBJdCB3aWxsIGNhdGNoIHRoZSBlcnJvclxuICogYW5kIGNsb3NlIHRoZSB1bmRlcmx5aW5nIGNvbm5lY3Rpb24uXG4gKi9cbmV4cG9ydCB0eXBlIEhhbmRsZXIgPSAoXG4gIHJlcXVlc3Q6IFJlcXVlc3QsXG4gIGNvbm5JbmZvOiBDb25uSW5mbyxcbikgPT4gUmVzcG9uc2UgfCBQcm9taXNlPFJlc3BvbnNlPjtcblxuLyoqIE9wdGlvbnMgZm9yIHJ1bm5pbmcgYW4gSFRUUCBzZXJ2ZXIuICovXG5leHBvcnQgaW50ZXJmYWNlIFNlcnZlckluaXQgZXh0ZW5kcyBQYXJ0aWFsPERlbm8uTGlzdGVuT3B0aW9ucz4ge1xuICAvKiogVGhlIGhhbmRsZXIgdG8gaW52b2tlIGZvciBpbmRpdmlkdWFsIEhUVFAgcmVxdWVzdHMuICovXG4gIGhhbmRsZXI6IEhhbmRsZXI7XG5cbiAgLyoqXG4gICAqIFRoZSBoYW5kbGVyIHRvIGludm9rZSB3aGVuIHJvdXRlIGhhbmRsZXJzIHRocm93IGFuIGVycm9yLlxuICAgKlxuICAgKiBUaGUgZGVmYXVsdCBlcnJvciBoYW5kbGVyIGxvZ3MgYW5kIHJldHVybnMgdGhlIGVycm9yIGluIEpTT04gZm9ybWF0LlxuICAgKi9cbiAgb25FcnJvcj86IChlcnJvcjogdW5rbm93bikgPT4gUmVzcG9uc2UgfCBQcm9taXNlPFJlc3BvbnNlPjtcbn1cblxuLyoqIFVzZWQgdG8gY29uc3RydWN0IGFuIEhUVFAgc2VydmVyLiAqL1xuZXhwb3J0IGNsYXNzIFNlcnZlciB7XG4gICNwb3J0PzogbnVtYmVyO1xuICAjaG9zdD86IHN0cmluZztcbiAgI2hhbmRsZXI6IEhhbmRsZXI7XG4gICNjbG9zZWQgPSBmYWxzZTtcbiAgI2xpc3RlbmVyczogU2V0PERlbm8uTGlzdGVuZXI+ID0gbmV3IFNldCgpO1xuICAjaHR0cENvbm5lY3Rpb25zOiBTZXQ8RGVuby5IdHRwQ29ubj4gPSBuZXcgU2V0KCk7XG4gICNvbkVycm9yOiAoZXJyb3I6IHVua25vd24pID0+IFJlc3BvbnNlIHwgUHJvbWlzZTxSZXNwb25zZT47XG5cbiAgLyoqXG4gICAqIENvbnN0cnVjdHMgYSBuZXcgSFRUUCBTZXJ2ZXIgaW5zdGFuY2UuXG4gICAqXG4gICAqIGBgYHRzXG4gICAqIGltcG9ydCB7IFNlcnZlciB9IGZyb20gXCJodHRwczovL2Rlbm8ubGFuZC9zdGRAJFNURF9WRVJTSU9OL2h0dHAvc2VydmVyLnRzXCI7XG4gICAqXG4gICAqIGNvbnN0IHBvcnQgPSA0NTA1O1xuICAgKiBjb25zdCBoYW5kbGVyID0gKHJlcXVlc3Q6IFJlcXVlc3QpID0+IHtcbiAgICogICBjb25zdCBib2R5ID0gYFlvdXIgdXNlci1hZ2VudCBpczpcXG5cXG4ke3JlcXVlc3QuaGVhZGVycy5nZXQoXG4gICAqICAgIFwidXNlci1hZ2VudFwiLFxuICAgKiAgICkgPz8gXCJVbmtub3duXCJ9YDtcbiAgICpcbiAgICogICByZXR1cm4gbmV3IFJlc3BvbnNlKGJvZHksIHsgc3RhdHVzOiAyMDAgfSk7XG4gICAqIH07XG4gICAqXG4gICAqIGNvbnN0IHNlcnZlciA9IG5ldyBTZXJ2ZXIoeyBwb3J0LCBoYW5kbGVyIH0pO1xuICAgKiBgYGBcbiAgICpcbiAgICogQHBhcmFtIHNlcnZlckluaXQgT3B0aW9ucyBmb3IgcnVubmluZyBhbiBIVFRQIHNlcnZlci5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHNlcnZlckluaXQ6IFNlcnZlckluaXQpIHtcbiAgICB0aGlzLiNwb3J0ID0gc2VydmVySW5pdC5wb3J0O1xuICAgIHRoaXMuI2hvc3QgPSBzZXJ2ZXJJbml0Lmhvc3RuYW1lO1xuICAgIHRoaXMuI2hhbmRsZXIgPSBzZXJ2ZXJJbml0LmhhbmRsZXI7XG4gICAgdGhpcy4jb25FcnJvciA9IHNlcnZlckluaXQub25FcnJvciA/P1xuICAgICAgZnVuY3Rpb24gKGVycm9yOiB1bmtub3duKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoZXJyb3IpO1xuICAgICAgICByZXR1cm4gbmV3IFJlc3BvbnNlKFwiSW50ZXJuYWwgU2VydmVyIEVycm9yXCIsIHsgc3RhdHVzOiA1MDAgfSk7XG4gICAgICB9O1xuICB9XG5cbiAgLyoqXG4gICAqIEFjY2VwdCBpbmNvbWluZyBjb25uZWN0aW9ucyBvbiB0aGUgZ2l2ZW4gbGlzdGVuZXIsIGFuZCBoYW5kbGUgcmVxdWVzdHMgb25cbiAgICogdGhlc2UgY29ubmVjdGlvbnMgd2l0aCB0aGUgZ2l2ZW4gaGFuZGxlci5cbiAgICpcbiAgICogSFRUUC8yIHN1cHBvcnQgaXMgb25seSBlbmFibGVkIGlmIHRoZSBwcm92aWRlZCBEZW5vLkxpc3RlbmVyIHJldHVybnMgVExTXG4gICAqIGNvbm5lY3Rpb25zIGFuZCB3YXMgY29uZmlndXJlZCB3aXRoIFwiaDJcIiBpbiB0aGUgQUxQTiBwcm90b2NvbHMuXG4gICAqXG4gICAqIFRocm93cyBhIHNlcnZlciBjbG9zZWQgZXJyb3IgaWYgY2FsbGVkIGFmdGVyIHRoZSBzZXJ2ZXIgaGFzIGJlZW4gY2xvc2VkLlxuICAgKlxuICAgKiBXaWxsIGFsd2F5cyBjbG9zZSB0aGUgY3JlYXRlZCBsaXN0ZW5lci5cbiAgICpcbiAgICogYGBgdHNcbiAgICogaW1wb3J0IHsgU2VydmVyIH0gZnJvbSBcImh0dHBzOi8vZGVuby5sYW5kL3N0ZEAkU1REX1ZFUlNJT04vaHR0cC9zZXJ2ZXIudHNcIjtcbiAgICpcbiAgICogY29uc3QgaGFuZGxlciA9IChyZXF1ZXN0OiBSZXF1ZXN0KSA9PiB7XG4gICAqICAgY29uc3QgYm9keSA9IGBZb3VyIHVzZXItYWdlbnQgaXM6XFxuXFxuJHtyZXF1ZXN0LmhlYWRlcnMuZ2V0KFxuICAgKiAgICBcInVzZXItYWdlbnRcIixcbiAgICogICApID8/IFwiVW5rbm93blwifWA7XG4gICAqXG4gICAqICAgcmV0dXJuIG5ldyBSZXNwb25zZShib2R5LCB7IHN0YXR1czogMjAwIH0pO1xuICAgKiB9O1xuICAgKlxuICAgKiBjb25zdCBzZXJ2ZXIgPSBuZXcgU2VydmVyKHsgaGFuZGxlciB9KTtcbiAgICogY29uc3QgbGlzdGVuZXIgPSBEZW5vLmxpc3Rlbih7IHBvcnQ6IDQ1MDUgfSk7XG4gICAqXG4gICAqIGNvbnNvbGUubG9nKFwic2VydmVyIGxpc3RlbmluZyBvbiBodHRwOi8vbG9jYWxob3N0OjQ1MDVcIik7XG4gICAqXG4gICAqIGF3YWl0IHNlcnZlci5zZXJ2ZShsaXN0ZW5lcik7XG4gICAqIGBgYFxuICAgKlxuICAgKiBAcGFyYW0gbGlzdGVuZXIgVGhlIGxpc3RlbmVyIHRvIGFjY2VwdCBjb25uZWN0aW9ucyBmcm9tLlxuICAgKi9cbiAgYXN5bmMgc2VydmUobGlzdGVuZXI6IERlbm8uTGlzdGVuZXIpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAodGhpcy4jY2xvc2VkKSB7XG4gICAgICB0aHJvdyBuZXcgRGVuby5lcnJvcnMuSHR0cChFUlJPUl9TRVJWRVJfQ0xPU0VEKTtcbiAgICB9XG5cbiAgICB0aGlzLiN0cmFja0xpc3RlbmVyKGxpc3RlbmVyKTtcblxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy4jYWNjZXB0KGxpc3RlbmVyKTtcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy4jdW50cmFja0xpc3RlbmVyKGxpc3RlbmVyKTtcblxuICAgICAgdHJ5IHtcbiAgICAgICAgbGlzdGVuZXIuY2xvc2UoKTtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBMaXN0ZW5lciBoYXMgYWxyZWFkeSBiZWVuIGNsb3NlZC5cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlIGEgbGlzdGVuZXIgb24gdGhlIHNlcnZlciwgYWNjZXB0IGluY29taW5nIGNvbm5lY3Rpb25zLCBhbmQgaGFuZGxlXG4gICAqIHJlcXVlc3RzIG9uIHRoZXNlIGNvbm5lY3Rpb25zIHdpdGggdGhlIGdpdmVuIGhhbmRsZXIuXG4gICAqXG4gICAqIElmIHRoZSBzZXJ2ZXIgd2FzIGNvbnN0cnVjdGVkIHdpdGhvdXQgYSBzcGVjaWZpZWQgcG9ydCwgODAgaXMgdXNlZC5cbiAgICpcbiAgICogSWYgdGhlIHNlcnZlciB3YXMgY29uc3RydWN0ZWQgd2l0aCB0aGUgaG9zdG5hbWUgb21pdHRlZCBmcm9tIHRoZSBvcHRpb25zLCB0aGVcbiAgICogbm9uLXJvdXRhYmxlIG1ldGEtYWRkcmVzcyBgMC4wLjAuMGAgaXMgdXNlZC5cbiAgICpcbiAgICogVGhyb3dzIGEgc2VydmVyIGNsb3NlZCBlcnJvciBpZiB0aGUgc2VydmVyIGhhcyBiZWVuIGNsb3NlZC5cbiAgICpcbiAgICogYGBgdHNcbiAgICogaW1wb3J0IHsgU2VydmVyIH0gZnJvbSBcImh0dHBzOi8vZGVuby5sYW5kL3N0ZEAkU1REX1ZFUlNJT04vaHR0cC9zZXJ2ZXIudHNcIjtcbiAgICpcbiAgICogY29uc3QgcG9ydCA9IDQ1MDU7XG4gICAqIGNvbnN0IGhhbmRsZXIgPSAocmVxdWVzdDogUmVxdWVzdCkgPT4ge1xuICAgKiAgIGNvbnN0IGJvZHkgPSBgWW91ciB1c2VyLWFnZW50IGlzOlxcblxcbiR7cmVxdWVzdC5oZWFkZXJzLmdldChcbiAgICogICAgXCJ1c2VyLWFnZW50XCIsXG4gICAqICAgKSA/PyBcIlVua25vd25cIn1gO1xuICAgKlxuICAgKiAgIHJldHVybiBuZXcgUmVzcG9uc2UoYm9keSwgeyBzdGF0dXM6IDIwMCB9KTtcbiAgICogfTtcbiAgICpcbiAgICogY29uc3Qgc2VydmVyID0gbmV3IFNlcnZlcih7IHBvcnQsIGhhbmRsZXIgfSk7XG4gICAqXG4gICAqIGNvbnNvbGUubG9nKFwic2VydmVyIGxpc3RlbmluZyBvbiBodHRwOi8vbG9jYWxob3N0OjQ1MDVcIik7XG4gICAqXG4gICAqIGF3YWl0IHNlcnZlci5saXN0ZW5BbmRTZXJ2ZSgpO1xuICAgKiBgYGBcbiAgICovXG4gIGFzeW5jIGxpc3RlbkFuZFNlcnZlKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICh0aGlzLiNjbG9zZWQpIHtcbiAgICAgIHRocm93IG5ldyBEZW5vLmVycm9ycy5IdHRwKEVSUk9SX1NFUlZFUl9DTE9TRUQpO1xuICAgIH1cblxuICAgIGNvbnN0IGxpc3RlbmVyID0gRGVuby5saXN0ZW4oe1xuICAgICAgcG9ydDogdGhpcy4jcG9ydCA/PyBIVFRQX1BPUlQsXG4gICAgICBob3N0bmFtZTogdGhpcy4jaG9zdCA/PyBcIjAuMC4wLjBcIixcbiAgICAgIHRyYW5zcG9ydDogXCJ0Y3BcIixcbiAgICB9KTtcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLnNlcnZlKGxpc3RlbmVyKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGUgYSBsaXN0ZW5lciBvbiB0aGUgc2VydmVyLCBhY2NlcHQgaW5jb21pbmcgY29ubmVjdGlvbnMsIHVwZ3JhZGUgdGhlbVxuICAgKiB0byBUTFMsIGFuZCBoYW5kbGUgcmVxdWVzdHMgb24gdGhlc2UgY29ubmVjdGlvbnMgd2l0aCB0aGUgZ2l2ZW4gaGFuZGxlci5cbiAgICpcbiAgICogSWYgdGhlIHNlcnZlciB3YXMgY29uc3RydWN0ZWQgd2l0aG91dCBhIHNwZWNpZmllZCBwb3J0LCA0NDMgaXMgdXNlZC5cbiAgICpcbiAgICogSWYgdGhlIHNlcnZlciB3YXMgY29uc3RydWN0ZWQgd2l0aCB0aGUgaG9zdG5hbWUgb21pdHRlZCBmcm9tIHRoZSBvcHRpb25zLCB0aGVcbiAgICogbm9uLXJvdXRhYmxlIG1ldGEtYWRkcmVzcyBgMC4wLjAuMGAgaXMgdXNlZC5cbiAgICpcbiAgICogVGhyb3dzIGEgc2VydmVyIGNsb3NlZCBlcnJvciBpZiB0aGUgc2VydmVyIGhhcyBiZWVuIGNsb3NlZC5cbiAgICpcbiAgICogYGBgdHNcbiAgICogaW1wb3J0IHsgU2VydmVyIH0gZnJvbSBcImh0dHBzOi8vZGVuby5sYW5kL3N0ZEAkU1REX1ZFUlNJT04vaHR0cC9zZXJ2ZXIudHNcIjtcbiAgICpcbiAgICogY29uc3QgcG9ydCA9IDQ1MDU7XG4gICAqIGNvbnN0IGhhbmRsZXIgPSAocmVxdWVzdDogUmVxdWVzdCkgPT4ge1xuICAgKiAgIGNvbnN0IGJvZHkgPSBgWW91ciB1c2VyLWFnZW50IGlzOlxcblxcbiR7cmVxdWVzdC5oZWFkZXJzLmdldChcbiAgICogICAgXCJ1c2VyLWFnZW50XCIsXG4gICAqICAgKSA/PyBcIlVua25vd25cIn1gO1xuICAgKlxuICAgKiAgIHJldHVybiBuZXcgUmVzcG9uc2UoYm9keSwgeyBzdGF0dXM6IDIwMCB9KTtcbiAgICogfTtcbiAgICpcbiAgICogY29uc3Qgc2VydmVyID0gbmV3IFNlcnZlcih7IHBvcnQsIGhhbmRsZXIgfSk7XG4gICAqXG4gICAqIGNvbnN0IGNlcnRGaWxlID0gXCIvcGF0aC90by9jZXJ0RmlsZS5jcnRcIjtcbiAgICogY29uc3Qga2V5RmlsZSA9IFwiL3BhdGgvdG8va2V5RmlsZS5rZXlcIjtcbiAgICpcbiAgICogY29uc29sZS5sb2coXCJzZXJ2ZXIgbGlzdGVuaW5nIG9uIGh0dHBzOi8vbG9jYWxob3N0OjQ1MDVcIik7XG4gICAqXG4gICAqIGF3YWl0IHNlcnZlci5saXN0ZW5BbmRTZXJ2ZVRscyhjZXJ0RmlsZSwga2V5RmlsZSk7XG4gICAqIGBgYFxuICAgKlxuICAgKiBAcGFyYW0gY2VydEZpbGUgVGhlIHBhdGggdG8gdGhlIGZpbGUgY29udGFpbmluZyB0aGUgVExTIGNlcnRpZmljYXRlLlxuICAgKiBAcGFyYW0ga2V5RmlsZSBUaGUgcGF0aCB0byB0aGUgZmlsZSBjb250YWluaW5nIHRoZSBUTFMgcHJpdmF0ZSBrZXkuXG4gICAqL1xuICBhc3luYyBsaXN0ZW5BbmRTZXJ2ZVRscyhjZXJ0RmlsZTogc3RyaW5nLCBrZXlGaWxlOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAodGhpcy4jY2xvc2VkKSB7XG4gICAgICB0aHJvdyBuZXcgRGVuby5lcnJvcnMuSHR0cChFUlJPUl9TRVJWRVJfQ0xPU0VEKTtcbiAgICB9XG5cbiAgICBjb25zdCBsaXN0ZW5lciA9IERlbm8ubGlzdGVuVGxzKHtcbiAgICAgIHBvcnQ6IHRoaXMuI3BvcnQgPz8gSFRUUFNfUE9SVCxcbiAgICAgIGhvc3RuYW1lOiB0aGlzLiNob3N0ID8/IFwiMC4wLjAuMFwiLFxuICAgICAgY2VydEZpbGUsXG4gICAgICBrZXlGaWxlLFxuICAgICAgdHJhbnNwb3J0OiBcInRjcFwiLFxuICAgICAgLy8gQUxQTiBwcm90b2NvbCBzdXBwb3J0IG5vdCB5ZXQgc3RhYmxlLlxuICAgICAgLy8gYWxwblByb3RvY29sczogW1wiaDJcIiwgXCJodHRwLzEuMVwiXSxcbiAgICB9KTtcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLnNlcnZlKGxpc3RlbmVyKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBJbW1lZGlhdGVseSBjbG9zZSB0aGUgc2VydmVyIGxpc3RlbmVycyBhbmQgYXNzb2NpYXRlZCBIVFRQIGNvbm5lY3Rpb25zLlxuICAgKlxuICAgKiBUaHJvd3MgYSBzZXJ2ZXIgY2xvc2VkIGVycm9yIGlmIGNhbGxlZCBhZnRlciB0aGUgc2VydmVyIGhhcyBiZWVuIGNsb3NlZC5cbiAgICovXG4gIGNsb3NlKCk6IHZvaWQge1xuICAgIGlmICh0aGlzLiNjbG9zZWQpIHtcbiAgICAgIHRocm93IG5ldyBEZW5vLmVycm9ycy5IdHRwKEVSUk9SX1NFUlZFUl9DTE9TRUQpO1xuICAgIH1cblxuICAgIHRoaXMuI2Nsb3NlZCA9IHRydWU7XG5cbiAgICBmb3IgKGNvbnN0IGxpc3RlbmVyIG9mIHRoaXMuI2xpc3RlbmVycykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgbGlzdGVuZXIuY2xvc2UoKTtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBMaXN0ZW5lciBoYXMgYWxyZWFkeSBiZWVuIGNsb3NlZC5cbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLiNsaXN0ZW5lcnMuY2xlYXIoKTtcblxuICAgIGZvciAoY29uc3QgaHR0cENvbm4gb2YgdGhpcy4jaHR0cENvbm5lY3Rpb25zKSB7XG4gICAgICB0aGlzLiNjbG9zZUh0dHBDb25uKGh0dHBDb25uKTtcbiAgICB9XG5cbiAgICB0aGlzLiNodHRwQ29ubmVjdGlvbnMuY2xlYXIoKTtcbiAgfVxuXG4gIC8qKiBHZXQgd2hldGhlciB0aGUgc2VydmVyIGlzIGNsb3NlZC4gKi9cbiAgZ2V0IGNsb3NlZCgpOiBib29sZWFuIHtcbiAgICByZXR1cm4gdGhpcy4jY2xvc2VkO1xuICB9XG5cbiAgLyoqIEdldCB0aGUgbGlzdCBvZiBuZXR3b3JrIGFkZHJlc3NlcyB0aGUgc2VydmVyIGlzIGxpc3RlbmluZyBvbi4gKi9cbiAgZ2V0IGFkZHJzKCk6IERlbm8uQWRkcltdIHtcbiAgICByZXR1cm4gQXJyYXkuZnJvbSh0aGlzLiNsaXN0ZW5lcnMpLm1hcCgobGlzdGVuZXIpID0+IGxpc3RlbmVyLmFkZHIpO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlc3BvbmRzIHRvIGFuIEhUVFAgcmVxdWVzdC5cbiAgICpcbiAgICogQHBhcmFtIHJlcXVlc3RFdmVudCBUaGUgSFRUUCByZXF1ZXN0IHRvIHJlc3BvbmQgdG8uXG4gICAqIEBwYXJhbSBodHRwQ29uIFRoZSBIVFRQIGNvbm5lY3Rpb24gdG8geWllbGQgcmVxdWVzdHMgZnJvbS5cbiAgICogQHBhcmFtIGNvbm5JbmZvIEluZm9ybWF0aW9uIGFib3V0IHRoZSB1bmRlcmx5aW5nIGNvbm5lY3Rpb24uXG4gICAqL1xuICBhc3luYyAjcmVzcG9uZChcbiAgICByZXF1ZXN0RXZlbnQ6IERlbm8uUmVxdWVzdEV2ZW50LFxuICAgIGh0dHBDb25uOiBEZW5vLkh0dHBDb25uLFxuICAgIGNvbm5JbmZvOiBDb25uSW5mbyxcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgbGV0IHJlc3BvbnNlOiBSZXNwb25zZTtcbiAgICB0cnkge1xuICAgICAgLy8gSGFuZGxlIHRoZSByZXF1ZXN0IGV2ZW50LCBnZW5lcmF0aW5nIGEgcmVzcG9uc2UuXG4gICAgICByZXNwb25zZSA9IGF3YWl0IHRoaXMuI2hhbmRsZXIocmVxdWVzdEV2ZW50LnJlcXVlc3QsIGNvbm5JbmZvKTtcbiAgICB9IGNhdGNoIChlcnJvcjogdW5rbm93bikge1xuICAgICAgLy8gSW52b2tlIG9uRXJyb3IgaGFuZGxlciB3aGVuIHJlcXVlc3QgaGFuZGxlciB0aHJvd3MuXG4gICAgICByZXNwb25zZSA9IGF3YWl0IHRoaXMuI29uRXJyb3IoZXJyb3IpO1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICAvLyBTZW5kIHRoZSByZXNwb25zZS5cbiAgICAgIGF3YWl0IHJlcXVlc3RFdmVudC5yZXNwb25kV2l0aChyZXNwb25zZSk7XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyByZXNwb25kV2l0aCgpIGZhaWxzIHdoZW4gdGhlIGNvbm5lY3Rpb24gaGFzIGFscmVhZHkgYmVlbiBjbG9zZWQsIG9yIHRoZXJlIGlzIHNvbWVcbiAgICAgIC8vIG90aGVyIGVycm9yIHdpdGggcmVzcG9uZGluZyBvbiB0aGlzIGNvbm5lY3Rpb24gdGhhdCBwcm9tcHRzIHVzIHRvXG4gICAgICAvLyBjbG9zZSBpdCBhbmQgb3BlbiBhIG5ldyBjb25uZWN0aW9uLlxuICAgICAgcmV0dXJuIHRoaXMuI2Nsb3NlSHR0cENvbm4oaHR0cENvbm4pO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBTZXJ2ZXMgYWxsIEhUVFAgcmVxdWVzdHMgb24gYSBzaW5nbGUgY29ubmVjdGlvbi5cbiAgICpcbiAgICogQHBhcmFtIGh0dHBDb25uIFRoZSBIVFRQIGNvbm5lY3Rpb24gdG8geWllbGQgcmVxdWVzdHMgZnJvbS5cbiAgICogQHBhcmFtIGNvbm5JbmZvIEluZm9ybWF0aW9uIGFib3V0IHRoZSB1bmRlcmx5aW5nIGNvbm5lY3Rpb24uXG4gICAqL1xuICBhc3luYyAjc2VydmVIdHRwKGh0dHBDb25uOiBEZW5vLkh0dHBDb25uLCBjb25uSW5mbzogQ29ubkluZm8pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB3aGlsZSAoIXRoaXMuI2Nsb3NlZCkge1xuICAgICAgbGV0IHJlcXVlc3RFdmVudDogRGVuby5SZXF1ZXN0RXZlbnQgfCBudWxsO1xuXG4gICAgICB0cnkge1xuICAgICAgICAvLyBZaWVsZCB0aGUgbmV3IEhUVFAgcmVxdWVzdCBvbiB0aGUgY29ubmVjdGlvbi5cbiAgICAgICAgcmVxdWVzdEV2ZW50ID0gYXdhaXQgaHR0cENvbm4ubmV4dFJlcXVlc3QoKTtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBDb25uZWN0aW9uIGhhcyBiZWVuIGNsb3NlZC5cbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG5cbiAgICAgIGlmIChyZXF1ZXN0RXZlbnQgPT09IG51bGwpIHtcbiAgICAgICAgLy8gQ29ubmVjdGlvbiBoYXMgYmVlbiBjbG9zZWQuXG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuXG4gICAgICAvLyBSZXNwb25kIHRvIHRoZSByZXF1ZXN0LiBOb3RlIHdlIGRvIG5vdCBhd2FpdCB0aGlzIGFzeW5jIG1ldGhvZCB0b1xuICAgICAgLy8gYWxsb3cgdGhlIGNvbm5lY3Rpb24gdG8gaGFuZGxlIG11bHRpcGxlIHJlcXVlc3RzIGluIHRoZSBjYXNlIG9mIGgyLlxuICAgICAgdGhpcy4jcmVzcG9uZChyZXF1ZXN0RXZlbnQsIGh0dHBDb25uLCBjb25uSW5mbyk7XG4gICAgfVxuXG4gICAgdGhpcy4jY2xvc2VIdHRwQ29ubihodHRwQ29ubik7XG4gIH1cblxuICAvKipcbiAgICogQWNjZXB0cyBhbGwgY29ubmVjdGlvbnMgb24gYSBzaW5nbGUgbmV0d29yayBsaXN0ZW5lci5cbiAgICpcbiAgICogQHBhcmFtIGxpc3RlbmVyIFRoZSBsaXN0ZW5lciB0byBhY2NlcHQgY29ubmVjdGlvbnMgZnJvbS5cbiAgICovXG4gIGFzeW5jICNhY2NlcHQobGlzdGVuZXI6IERlbm8uTGlzdGVuZXIpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBsZXQgYWNjZXB0QmFja29mZkRlbGF5OiBudW1iZXIgfCB1bmRlZmluZWQ7XG5cbiAgICB3aGlsZSAoIXRoaXMuI2Nsb3NlZCkge1xuICAgICAgbGV0IGNvbm46IERlbm8uQ29ubjtcblxuICAgICAgdHJ5IHtcbiAgICAgICAgLy8gV2FpdCBmb3IgYSBuZXcgY29ubmVjdGlvbi5cbiAgICAgICAgY29ubiA9IGF3YWl0IGxpc3RlbmVyLmFjY2VwdCgpO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgaWYgKFxuICAgICAgICAgIC8vIFRoZSBsaXN0ZW5lciBpcyBjbG9zZWQuXG4gICAgICAgICAgZXJyb3IgaW5zdGFuY2VvZiBEZW5vLmVycm9ycy5CYWRSZXNvdXJjZSB8fFxuICAgICAgICAgIC8vIFRMUyBoYW5kc2hha2UgZXJyb3JzLlxuICAgICAgICAgIGVycm9yIGluc3RhbmNlb2YgRGVuby5lcnJvcnMuSW52YWxpZERhdGEgfHxcbiAgICAgICAgICBlcnJvciBpbnN0YW5jZW9mIERlbm8uZXJyb3JzLlVuZXhwZWN0ZWRFb2YgfHxcbiAgICAgICAgICBlcnJvciBpbnN0YW5jZW9mIERlbm8uZXJyb3JzLkNvbm5lY3Rpb25SZXNldCB8fFxuICAgICAgICAgIGVycm9yIGluc3RhbmNlb2YgRGVuby5lcnJvcnMuTm90Q29ubmVjdGVkXG4gICAgICAgICkge1xuICAgICAgICAgIC8vIEJhY2tvZmYgYWZ0ZXIgdHJhbnNpZW50IGVycm9ycyB0byBhbGxvdyB0aW1lIGZvciB0aGUgc3lzdGVtIHRvXG4gICAgICAgICAgLy8gcmVjb3ZlciwgYW5kIGF2b2lkIGJsb2NraW5nIHVwIHRoZSBldmVudCBsb29wIHdpdGggYSBjb250aW51b3VzbHlcbiAgICAgICAgICAvLyBydW5uaW5nIGxvb3AuXG4gICAgICAgICAgaWYgKCFhY2NlcHRCYWNrb2ZmRGVsYXkpIHtcbiAgICAgICAgICAgIGFjY2VwdEJhY2tvZmZEZWxheSA9IElOSVRJQUxfQUNDRVBUX0JBQ0tPRkZfREVMQVk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGFjY2VwdEJhY2tvZmZEZWxheSAqPSAyO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmIChhY2NlcHRCYWNrb2ZmRGVsYXkgPj0gTUFYX0FDQ0VQVF9CQUNLT0ZGX0RFTEFZKSB7XG4gICAgICAgICAgICBhY2NlcHRCYWNrb2ZmRGVsYXkgPSBNQVhfQUNDRVBUX0JBQ0tPRkZfREVMQVk7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgYXdhaXQgZGVsYXkoYWNjZXB0QmFja29mZkRlbGF5KTtcblxuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICB9XG5cbiAgICAgIGFjY2VwdEJhY2tvZmZEZWxheSA9IHVuZGVmaW5lZDtcblxuICAgICAgLy8gXCJVcGdyYWRlXCIgdGhlIG5ldHdvcmsgY29ubmVjdGlvbiBpbnRvIGFuIEhUVFAgY29ubmVjdGlvbi5cbiAgICAgIGxldCBodHRwQ29ubjogRGVuby5IdHRwQ29ubjtcblxuICAgICAgdHJ5IHtcbiAgICAgICAgaHR0cENvbm4gPSBEZW5vLnNlcnZlSHR0cChjb25uKTtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBDb25uZWN0aW9uIGhhcyBiZWVuIGNsb3NlZC5cbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIC8vIENsb3NpbmcgdGhlIHVuZGVybHlpbmcgbGlzdGVuZXIgd2lsbCBub3QgY2xvc2UgSFRUUCBjb25uZWN0aW9ucywgc28gd2VcbiAgICAgIC8vIHRyYWNrIGZvciBjbG9zdXJlIHVwb24gc2VydmVyIGNsb3NlLlxuICAgICAgdGhpcy4jdHJhY2tIdHRwQ29ubmVjdGlvbihodHRwQ29ubik7XG5cbiAgICAgIGNvbnN0IGNvbm5JbmZvOiBDb25uSW5mbyA9IHtcbiAgICAgICAgbG9jYWxBZGRyOiBjb25uLmxvY2FsQWRkcixcbiAgICAgICAgcmVtb3RlQWRkcjogY29ubi5yZW1vdGVBZGRyLFxuICAgICAgfTtcblxuICAgICAgLy8gU2VydmUgdGhlIHJlcXVlc3RzIHRoYXQgYXJyaXZlIG9uIHRoZSBqdXN0LWFjY2VwdGVkIGNvbm5lY3Rpb24uIE5vdGVcbiAgICAgIC8vIHdlIGRvIG5vdCBhd2FpdCB0aGlzIGFzeW5jIG1ldGhvZCB0byBhbGxvdyB0aGUgc2VydmVyIHRvIGFjY2VwdCBuZXdcbiAgICAgIC8vIGNvbm5lY3Rpb25zLlxuICAgICAgdGhpcy4jc2VydmVIdHRwKGh0dHBDb25uLCBjb25uSW5mbyk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFVudHJhY2tzIGFuZCBjbG9zZXMgYW4gSFRUUCBjb25uZWN0aW9uLlxuICAgKlxuICAgKiBAcGFyYW0gaHR0cENvbm4gVGhlIEhUVFAgY29ubmVjdGlvbiB0byBjbG9zZS5cbiAgICovXG4gICNjbG9zZUh0dHBDb25uKGh0dHBDb25uOiBEZW5vLkh0dHBDb25uKTogdm9pZCB7XG4gICAgdGhpcy4jdW50cmFja0h0dHBDb25uZWN0aW9uKGh0dHBDb25uKTtcblxuICAgIHRyeSB7XG4gICAgICBodHRwQ29ubi5jbG9zZSgpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gQ29ubmVjdGlvbiBoYXMgYWxyZWFkeSBiZWVuIGNsb3NlZC5cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQWRkcyB0aGUgbGlzdGVuZXIgdG8gdGhlIGludGVybmFsIHRyYWNraW5nIGxpc3QuXG4gICAqXG4gICAqIEBwYXJhbSBsaXN0ZW5lciBMaXN0ZW5lciB0byB0cmFjay5cbiAgICovXG4gICN0cmFja0xpc3RlbmVyKGxpc3RlbmVyOiBEZW5vLkxpc3RlbmVyKTogdm9pZCB7XG4gICAgdGhpcy4jbGlzdGVuZXJzLmFkZChsaXN0ZW5lcik7XG4gIH1cblxuICAvKipcbiAgICogUmVtb3ZlcyB0aGUgbGlzdGVuZXIgZnJvbSB0aGUgaW50ZXJuYWwgdHJhY2tpbmcgbGlzdC5cbiAgICpcbiAgICogQHBhcmFtIGxpc3RlbmVyIExpc3RlbmVyIHRvIHVudHJhY2suXG4gICAqL1xuICAjdW50cmFja0xpc3RlbmVyKGxpc3RlbmVyOiBEZW5vLkxpc3RlbmVyKTogdm9pZCB7XG4gICAgdGhpcy4jbGlzdGVuZXJzLmRlbGV0ZShsaXN0ZW5lcik7XG4gIH1cblxuICAvKipcbiAgICogQWRkcyB0aGUgSFRUUCBjb25uZWN0aW9uIHRvIHRoZSBpbnRlcm5hbCB0cmFja2luZyBsaXN0LlxuICAgKlxuICAgKiBAcGFyYW0gaHR0cENvbm4gSFRUUCBjb25uZWN0aW9uIHRvIHRyYWNrLlxuICAgKi9cbiAgI3RyYWNrSHR0cENvbm5lY3Rpb24oaHR0cENvbm46IERlbm8uSHR0cENvbm4pOiB2b2lkIHtcbiAgICB0aGlzLiNodHRwQ29ubmVjdGlvbnMuYWRkKGh0dHBDb25uKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZW1vdmVzIHRoZSBIVFRQIGNvbm5lY3Rpb24gZnJvbSB0aGUgaW50ZXJuYWwgdHJhY2tpbmcgbGlzdC5cbiAgICpcbiAgICogQHBhcmFtIGh0dHBDb25uIEhUVFAgY29ubmVjdGlvbiB0byB1bnRyYWNrLlxuICAgKi9cbiAgI3VudHJhY2tIdHRwQ29ubmVjdGlvbihodHRwQ29ubjogRGVuby5IdHRwQ29ubik6IHZvaWQge1xuICAgIHRoaXMuI2h0dHBDb25uZWN0aW9ucy5kZWxldGUoaHR0cENvbm4pO1xuICB9XG59XG5cbi8qKiBBZGRpdGlvbmFsIHNlcnZlIG9wdGlvbnMuICovXG5leHBvcnQgaW50ZXJmYWNlIFNlcnZlSW5pdCBleHRlbmRzIFBhcnRpYWw8RGVuby5MaXN0ZW5PcHRpb25zPiB7XG4gIC8qKiBBbiBBYm9ydFNpZ25hbCB0byBjbG9zZSB0aGUgc2VydmVyIGFuZCBhbGwgY29ubmVjdGlvbnMuICovXG4gIHNpZ25hbD86IEFib3J0U2lnbmFsO1xuXG4gIC8qKiBUaGUgaGFuZGxlciB0byBpbnZva2Ugd2hlbiByb3V0ZSBoYW5kbGVycyB0aHJvdyBhbiBlcnJvci4gKi9cbiAgb25FcnJvcj86IChlcnJvcjogdW5rbm93bikgPT4gUmVzcG9uc2UgfCBQcm9taXNlPFJlc3BvbnNlPjtcblxuICAvKiogVGhlIGNhbGxiYWNrIHdoaWNoIGlzIGNhbGxlZCB3aGVuIHRoZSBzZXJ2ZXIgc3RhcnRlZCBsaXN0ZW5pbmcgKi9cbiAgb25MaXN0ZW4/OiAocGFyYW1zOiB7IGhvc3RuYW1lOiBzdHJpbmc7IHBvcnQ6IG51bWJlciB9KSA9PiB2b2lkO1xufVxuXG4vKipcbiAqIENvbnN0cnVjdHMgYSBzZXJ2ZXIsIGFjY2VwdHMgaW5jb21pbmcgY29ubmVjdGlvbnMgb24gdGhlIGdpdmVuIGxpc3RlbmVyLCBhbmRcbiAqIGhhbmRsZXMgcmVxdWVzdHMgb24gdGhlc2UgY29ubmVjdGlvbnMgd2l0aCB0aGUgZ2l2ZW4gaGFuZGxlci5cbiAqXG4gKiBgYGB0c1xuICogaW1wb3J0IHsgc2VydmVMaXN0ZW5lciB9IGZyb20gXCJodHRwczovL2Rlbm8ubGFuZC9zdGRAJFNURF9WRVJTSU9OL2h0dHAvc2VydmVyLnRzXCI7XG4gKlxuICogY29uc3QgbGlzdGVuZXIgPSBEZW5vLmxpc3Rlbih7IHBvcnQ6IDQ1MDUgfSk7XG4gKlxuICogY29uc29sZS5sb2coXCJzZXJ2ZXIgbGlzdGVuaW5nIG9uIGh0dHA6Ly9sb2NhbGhvc3Q6NDUwNVwiKTtcbiAqXG4gKiBhd2FpdCBzZXJ2ZUxpc3RlbmVyKGxpc3RlbmVyLCAocmVxdWVzdCkgPT4ge1xuICogICBjb25zdCBib2R5ID0gYFlvdXIgdXNlci1hZ2VudCBpczpcXG5cXG4ke3JlcXVlc3QuaGVhZGVycy5nZXQoXG4gKiAgICAgXCJ1c2VyLWFnZW50XCIsXG4gKiAgICkgPz8gXCJVbmtub3duXCJ9YDtcbiAqXG4gKiAgIHJldHVybiBuZXcgUmVzcG9uc2UoYm9keSwgeyBzdGF0dXM6IDIwMCB9KTtcbiAqIH0pO1xuICogYGBgXG4gKlxuICogQHBhcmFtIGxpc3RlbmVyIFRoZSBsaXN0ZW5lciB0byBhY2NlcHQgY29ubmVjdGlvbnMgZnJvbS5cbiAqIEBwYXJhbSBoYW5kbGVyIFRoZSBoYW5kbGVyIGZvciBpbmRpdmlkdWFsIEhUVFAgcmVxdWVzdHMuXG4gKiBAcGFyYW0gb3B0aW9ucyBPcHRpb25hbCBzZXJ2ZSBvcHRpb25zLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gc2VydmVMaXN0ZW5lcihcbiAgbGlzdGVuZXI6IERlbm8uTGlzdGVuZXIsXG4gIGhhbmRsZXI6IEhhbmRsZXIsXG4gIG9wdGlvbnM/OiBPbWl0PFNlcnZlSW5pdCwgXCJwb3J0XCIgfCBcImhvc3RuYW1lXCI+LFxuKTogUHJvbWlzZTx2b2lkPiB7XG4gIGNvbnN0IHNlcnZlciA9IG5ldyBTZXJ2ZXIoeyBoYW5kbGVyLCBvbkVycm9yOiBvcHRpb25zPy5vbkVycm9yIH0pO1xuXG4gIG9wdGlvbnM/LnNpZ25hbD8uYWRkRXZlbnRMaXN0ZW5lcihcImFib3J0XCIsICgpID0+IHNlcnZlci5jbG9zZSgpLCB7XG4gICAgb25jZTogdHJ1ZSxcbiAgfSk7XG5cbiAgcmV0dXJuIGF3YWl0IHNlcnZlci5zZXJ2ZShsaXN0ZW5lcik7XG59XG5cbmZ1bmN0aW9uIGhvc3RuYW1lRm9yRGlzcGxheShob3N0bmFtZTogc3RyaW5nKSB7XG4gIC8vIElmIHRoZSBob3N0bmFtZSBpcyBcIjAuMC4wLjBcIiwgd2UgZGlzcGxheSBcImxvY2FsaG9zdFwiIGluIGNvbnNvbGVcbiAgLy8gYmVjYXVzZSBicm93c2VycyBpbiBXaW5kb3dzIGRvbid0IHJlc29sdmUgXCIwLjAuMC4wXCIuXG4gIC8vIFNlZSB0aGUgZGlzY3Vzc2lvbiBpbiBodHRwczovL2dpdGh1Yi5jb20vZGVub2xhbmQvZGVub19zdGQvaXNzdWVzLzExNjVcbiAgcmV0dXJuIGhvc3RuYW1lID09PSBcIjAuMC4wLjBcIiA/IFwibG9jYWxob3N0XCIgOiBob3N0bmFtZTtcbn1cblxuLyoqIFNlcnZlcyBIVFRQIHJlcXVlc3RzIHdpdGggdGhlIGdpdmVuIGhhbmRsZXIuXG4gKlxuICogWW91IGNhbiBzcGVjaWZ5IGFuIG9iamVjdCB3aXRoIGEgcG9ydCBhbmQgaG9zdG5hbWUgb3B0aW9uLCB3aGljaCBpcyB0aGVcbiAqIGFkZHJlc3MgdG8gbGlzdGVuIG9uLiBUaGUgZGVmYXVsdCBpcyBwb3J0IDgwMDAgb24gaG9zdG5hbWUgXCIwLjAuMC4wXCIuXG4gKlxuICogVGhlIGJlbG93IGV4YW1wbGUgc2VydmVzIHdpdGggdGhlIHBvcnQgODAwMC5cbiAqXG4gKiBgYGB0c1xuICogaW1wb3J0IHsgc2VydmUgfSBmcm9tIFwiaHR0cHM6Ly9kZW5vLmxhbmQvc3RkQCRTVERfVkVSU0lPTi9odHRwL3NlcnZlci50c1wiO1xuICogc2VydmUoKF9yZXEpID0+IG5ldyBSZXNwb25zZShcIkhlbGxvLCB3b3JsZFwiKSk7XG4gKiBgYGBcbiAqXG4gKiBZb3UgY2FuIGNoYW5nZSB0aGUgbGlzdGVuaW5nIGFkZHJlc3MgYnkgdGhlIGBob3N0bmFtZWAgYW5kIGBwb3J0YCBvcHRpb25zLlxuICogVGhlIGJlbG93IGV4YW1wbGUgc2VydmVzIHdpdGggdGhlIHBvcnQgMzAwMC5cbiAqXG4gKiBgYGB0c1xuICogaW1wb3J0IHsgc2VydmUgfSBmcm9tIFwiaHR0cHM6Ly9kZW5vLmxhbmQvc3RkQCRTVERfVkVSU0lPTi9odHRwL3NlcnZlci50c1wiO1xuICogc2VydmUoKF9yZXEpID0+IG5ldyBSZXNwb25zZShcIkhlbGxvLCB3b3JsZFwiKSwgeyBwb3J0OiAzMDAwIH0pO1xuICogYGBgXG4gKlxuICogYHNlcnZlYCBmdW5jdGlvbiBwcmludHMgdGhlIG1lc3NhZ2UgYExpc3RlbmluZyBvbiBodHRwOi8vPGhvc3RuYW1lPjo8cG9ydD4vYFxuICogb24gc3RhcnQtdXAgYnkgZGVmYXVsdC4gSWYgeW91IGxpa2UgdG8gY2hhbmdlIHRoaXMgbWVzc2FnZSwgeW91IGNhbiBzcGVjaWZ5XG4gKiBgb25MaXN0ZW5gIG9wdGlvbiB0byBvdmVycmlkZSBpdC5cbiAqXG4gKiBgYGB0c1xuICogaW1wb3J0IHsgc2VydmUgfSBmcm9tIFwiaHR0cHM6Ly9kZW5vLmxhbmQvc3RkQCRTVERfVkVSU0lPTi9odHRwL3NlcnZlci50c1wiO1xuICogc2VydmUoKF9yZXEpID0+IG5ldyBSZXNwb25zZShcIkhlbGxvLCB3b3JsZFwiKSwge1xuICogICBvbkxpc3Rlbih7IHBvcnQsIGhvc3RuYW1lIH0pIHtcbiAqICAgICBjb25zb2xlLmxvZyhgU2VydmVyIHN0YXJ0ZWQgYXQgaHR0cDovLyR7aG9zdG5hbWV9OiR7cG9ydH1gKTtcbiAqICAgICAvLyAuLi4gbW9yZSBpbmZvIHNwZWNpZmljIHRvIHlvdXIgc2VydmVyIC4uXG4gKiAgIH0sXG4gKiB9KTtcbiAqIGBgYFxuICpcbiAqIFlvdSBjYW4gYWxzbyBzcGVjaWZ5IGB1bmRlZmluZWRgIG9yIGBudWxsYCB0byBzdG9wIHRoZSBsb2dnaW5nIGJlaGF2aW9yLlxuICpcbiAqIGBgYHRzXG4gKiBpbXBvcnQgeyBzZXJ2ZSB9IGZyb20gXCJodHRwczovL2Rlbm8ubGFuZC9zdGRAJFNURF9WRVJTSU9OL2h0dHAvc2VydmVyLnRzXCI7XG4gKiBzZXJ2ZSgoX3JlcSkgPT4gbmV3IFJlc3BvbnNlKFwiSGVsbG8sIHdvcmxkXCIpLCB7IG9uTGlzdGVuOiB1bmRlZmluZWQgfSk7XG4gKiBgYGBcbiAqXG4gKiBAcGFyYW0gaGFuZGxlciBUaGUgaGFuZGxlciBmb3IgaW5kaXZpZHVhbCBIVFRQIHJlcXVlc3RzLlxuICogQHBhcmFtIG9wdGlvbnMgVGhlIG9wdGlvbnMuIFNlZSBgU2VydmVJbml0YCBkb2N1bWVudGF0aW9uIGZvciBkZXRhaWxzLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gc2VydmUoXG4gIGhhbmRsZXI6IEhhbmRsZXIsXG4gIG9wdGlvbnM6IFNlcnZlSW5pdCA9IHt9LFxuKTogUHJvbWlzZTx2b2lkPiB7XG4gIGNvbnN0IHBvcnQgPSBvcHRpb25zLnBvcnQgPz8gODAwMDtcbiAgY29uc3QgaG9zdG5hbWUgPSBvcHRpb25zLmhvc3RuYW1lID8/IFwiMC4wLjAuMFwiO1xuICBjb25zdCBzZXJ2ZXIgPSBuZXcgU2VydmVyKHtcbiAgICBwb3J0LFxuICAgIGhvc3RuYW1lLFxuICAgIGhhbmRsZXIsXG4gICAgb25FcnJvcjogb3B0aW9ucy5vbkVycm9yLFxuICB9KTtcblxuICBvcHRpb25zPy5zaWduYWw/LmFkZEV2ZW50TGlzdGVuZXIoXCJhYm9ydFwiLCAoKSA9PiBzZXJ2ZXIuY2xvc2UoKSwge1xuICAgIG9uY2U6IHRydWUsXG4gIH0pO1xuXG4gIGNvbnN0IHMgPSBzZXJ2ZXIubGlzdGVuQW5kU2VydmUoKTtcblxuICBpZiAoXCJvbkxpc3RlblwiIGluIG9wdGlvbnMpIHtcbiAgICBvcHRpb25zLm9uTGlzdGVuPy4oeyBwb3J0LCBob3N0bmFtZSB9KTtcbiAgfSBlbHNlIHtcbiAgICBjb25zb2xlLmxvZyhgTGlzdGVuaW5nIG9uIGh0dHA6Ly8ke2hvc3RuYW1lRm9yRGlzcGxheShob3N0bmFtZSl9OiR7cG9ydH0vYCk7XG4gIH1cblxuICByZXR1cm4gYXdhaXQgcztcbn1cblxuZXhwb3J0IGludGVyZmFjZSBTZXJ2ZVRsc0luaXQgZXh0ZW5kcyBTZXJ2ZUluaXQge1xuICAvKiogVGhlIHBhdGggdG8gdGhlIGZpbGUgY29udGFpbmluZyB0aGUgVExTIHByaXZhdGUga2V5LiAqL1xuICBrZXlGaWxlOiBzdHJpbmc7XG5cbiAgLyoqIFRoZSBwYXRoIHRvIHRoZSBmaWxlIGNvbnRhaW5pbmcgdGhlIFRMUyBjZXJ0aWZpY2F0ZSAqL1xuICBjZXJ0RmlsZTogc3RyaW5nO1xufVxuXG4vKiogU2VydmVzIEhUVFBTIHJlcXVlc3RzIHdpdGggdGhlIGdpdmVuIGhhbmRsZXIuXG4gKlxuICogWW91IG11c3Qgc3BlY2lmeSBga2V5RmlsZWAgYW5kIGBjZXJ0RmlsZWAgb3B0aW9ucy5cbiAqXG4gKiBZb3UgY2FuIHNwZWNpZnkgYW4gb2JqZWN0IHdpdGggYSBwb3J0IGFuZCBob3N0bmFtZSBvcHRpb24sIHdoaWNoIGlzIHRoZVxuICogYWRkcmVzcyB0byBsaXN0ZW4gb24uIFRoZSBkZWZhdWx0IGlzIHBvcnQgODQ0MyBvbiBob3N0bmFtZSBcIjAuMC4wLjBcIi5cbiAqXG4gKiBUaGUgYmVsb3cgZXhhbXBsZSBzZXJ2ZXMgd2l0aCB0aGUgZGVmYXVsdCBwb3J0IDg0NDMuXG4gKlxuICogYGBgdHNcbiAqIGltcG9ydCB7IHNlcnZlVGxzIH0gZnJvbSBcImh0dHBzOi8vZGVuby5sYW5kL3N0ZEAkU1REX1ZFUlNJT04vaHR0cC9zZXJ2ZXIudHNcIjtcbiAqIGNvbnN0IGNlcnRGaWxlID0gXCIvcGF0aC90by9jZXJ0RmlsZS5jcnRcIjtcbiAqIGNvbnN0IGtleUZpbGUgPSBcIi9wYXRoL3RvL2tleUZpbGUua2V5XCI7XG4gKiBzZXJ2ZVRscygoX3JlcSkgPT4gbmV3IFJlc3BvbnNlKFwiSGVsbG8sIHdvcmxkXCIpLCB7IGNlcnRGaWxlLCBrZXlGaWxlIH0pO1xuICogYGBgXG4gKlxuICogYHNlcnZlVGxzYCBmdW5jdGlvbiBwcmludHMgdGhlIG1lc3NhZ2UgYExpc3RlbmluZyBvbiBodHRwczovLzxob3N0bmFtZT46PHBvcnQ+L2BcbiAqIG9uIHN0YXJ0LXVwIGJ5IGRlZmF1bHQuIElmIHlvdSBsaWtlIHRvIGNoYW5nZSB0aGlzIG1lc3NhZ2UsIHlvdSBjYW4gc3BlY2lmeVxuICogYG9uTGlzdGVuYCBvcHRpb24gdG8gb3ZlcnJpZGUgaXQuXG4gKlxuICogYGBgdHNcbiAqIGltcG9ydCB7IHNlcnZlVGxzIH0gZnJvbSBcImh0dHBzOi8vZGVuby5sYW5kL3N0ZEAkU1REX1ZFUlNJT04vaHR0cC9zZXJ2ZXIudHNcIjtcbiAqIGNvbnN0IGNlcnRGaWxlID0gXCIvcGF0aC90by9jZXJ0RmlsZS5jcnRcIjtcbiAqIGNvbnN0IGtleUZpbGUgPSBcIi9wYXRoL3RvL2tleUZpbGUua2V5XCI7XG4gKiBzZXJ2ZVRscygoX3JlcSkgPT4gbmV3IFJlc3BvbnNlKFwiSGVsbG8sIHdvcmxkXCIpLCB7XG4gKiAgIGNlcnRGaWxlLFxuICogICBrZXlGaWxlLFxuICogICBvbkxpc3Rlbih7IHBvcnQsIGhvc3RuYW1lIH0pIHtcbiAqICAgICBjb25zb2xlLmxvZyhgU2VydmVyIHN0YXJ0ZWQgYXQgaHR0cHM6Ly8ke2hvc3RuYW1lfToke3BvcnR9YCk7XG4gKiAgICAgLy8gLi4uIG1vcmUgaW5mbyBzcGVjaWZpYyB0byB5b3VyIHNlcnZlciAuLlxuICogICB9LFxuICogfSk7XG4gKiBgYGBcbiAqXG4gKiBZb3UgY2FuIGFsc28gc3BlY2lmeSBgdW5kZWZpbmVkYCBvciBgbnVsbGAgdG8gc3RvcCB0aGUgbG9nZ2luZyBiZWhhdmlvci5cbiAqXG4gKiBgYGB0c1xuICogaW1wb3J0IHsgc2VydmVUbHMgfSBmcm9tIFwiaHR0cHM6Ly9kZW5vLmxhbmQvc3RkQCRTVERfVkVSU0lPTi9odHRwL3NlcnZlci50c1wiO1xuICogY29uc3QgY2VydEZpbGUgPSBcIi9wYXRoL3RvL2NlcnRGaWxlLmNydFwiO1xuICogY29uc3Qga2V5RmlsZSA9IFwiL3BhdGgvdG8va2V5RmlsZS5rZXlcIjtcbiAqIHNlcnZlVGxzKChfcmVxKSA9PiBuZXcgUmVzcG9uc2UoXCJIZWxsbywgd29ybGRcIiksIHtcbiAqICAgY2VydEZpbGUsXG4gKiAgIGtleUZpbGUsXG4gKiAgIG9uTGlzdGVuOiB1bmRlZmluZWQsXG4gKiB9KTtcbiAqIGBgYFxuICpcbiAqIEBwYXJhbSBoYW5kbGVyIFRoZSBoYW5kbGVyIGZvciBpbmRpdmlkdWFsIEhUVFBTIHJlcXVlc3RzLlxuICogQHBhcmFtIG9wdGlvbnMgVGhlIG9wdGlvbnMuIFNlZSBgU2VydmVUbHNJbml0YCBkb2N1bWVudGF0aW9uIGZvciBkZXRhaWxzLlxuICogQHJldHVybnNcbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHNlcnZlVGxzKFxuICBoYW5kbGVyOiBIYW5kbGVyLFxuICBvcHRpb25zOiBTZXJ2ZVRsc0luaXQsXG4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgaWYgKCFvcHRpb25zLmtleUZpbGUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJUTFMgY29uZmlnIGlzIGdpdmVuLCBidXQgJ2tleUZpbGUnIGlzIG1pc3NpbmcuXCIpO1xuICB9XG5cbiAgaWYgKCFvcHRpb25zLmNlcnRGaWxlKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiVExTIGNvbmZpZyBpcyBnaXZlbiwgYnV0ICdjZXJ0RmlsZScgaXMgbWlzc2luZy5cIik7XG4gIH1cblxuICBjb25zdCBwb3J0ID0gb3B0aW9ucy5wb3J0ID8/IDg0NDM7XG4gIGNvbnN0IGhvc3RuYW1lID0gb3B0aW9ucy5ob3N0bmFtZSA/PyBcIjAuMC4wLjBcIjtcbiAgY29uc3Qgc2VydmVyID0gbmV3IFNlcnZlcih7XG4gICAgcG9ydCxcbiAgICBob3N0bmFtZSxcbiAgICBoYW5kbGVyLFxuICAgIG9uRXJyb3I6IG9wdGlvbnMub25FcnJvcixcbiAgfSk7XG5cbiAgb3B0aW9ucz8uc2lnbmFsPy5hZGRFdmVudExpc3RlbmVyKFwiYWJvcnRcIiwgKCkgPT4gc2VydmVyLmNsb3NlKCksIHtcbiAgICBvbmNlOiB0cnVlLFxuICB9KTtcblxuICBjb25zdCBzID0gc2VydmVyLmxpc3RlbkFuZFNlcnZlVGxzKG9wdGlvbnMuY2VydEZpbGUsIG9wdGlvbnMua2V5RmlsZSk7XG5cbiAgaWYgKFwib25MaXN0ZW5cIiBpbiBvcHRpb25zKSB7XG4gICAgb3B0aW9ucy5vbkxpc3Rlbj8uKHsgcG9ydCwgaG9zdG5hbWUgfSk7XG4gIH0gZWxzZSB7XG4gICAgY29uc29sZS5sb2coXG4gICAgICBgTGlzdGVuaW5nIG9uIGh0dHBzOi8vJHtob3N0bmFtZUZvckRpc3BsYXkoaG9zdG5hbWUpfToke3BvcnR9L2AsXG4gICAgKTtcbiAgfVxuXG4gIHJldHVybiBhd2FpdCBzO1xufVxuXG4vKipcbiAqIEBkZXByZWNhdGVkIFVzZSBgc2VydmVgIGluc3RlYWQuXG4gKlxuICogQ29uc3RydWN0cyBhIHNlcnZlciwgY3JlYXRlcyBhIGxpc3RlbmVyIG9uIHRoZSBnaXZlbiBhZGRyZXNzLCBhY2NlcHRzXG4gKiBpbmNvbWluZyBjb25uZWN0aW9ucywgYW5kIGhhbmRsZXMgcmVxdWVzdHMgb24gdGhlc2UgY29ubmVjdGlvbnMgd2l0aCB0aGVcbiAqIGdpdmVuIGhhbmRsZXIuXG4gKlxuICogSWYgdGhlIHBvcnQgaXMgb21pdHRlZCBmcm9tIHRoZSBMaXN0ZW5PcHRpb25zLCA4MCBpcyB1c2VkLlxuICpcbiAqIElmIHRoZSBob3N0IGlzIG9taXR0ZWQgZnJvbSB0aGUgTGlzdGVuT3B0aW9ucywgdGhlIG5vbi1yb3V0YWJsZSBtZXRhLWFkZHJlc3NcbiAqIGAwLjAuMC4wYCBpcyB1c2VkLlxuICpcbiAqIGBgYHRzXG4gKiBpbXBvcnQgeyBsaXN0ZW5BbmRTZXJ2ZSB9IGZyb20gXCJodHRwczovL2Rlbm8ubGFuZC9zdGRAJFNURF9WRVJTSU9OL2h0dHAvc2VydmVyLnRzXCI7XG4gKlxuICogY29uc3QgcG9ydCA9IDQ1MDU7XG4gKlxuICogY29uc29sZS5sb2coXCJzZXJ2ZXIgbGlzdGVuaW5nIG9uIGh0dHA6Ly9sb2NhbGhvc3Q6NDUwNVwiKTtcbiAqXG4gKiBhd2FpdCBsaXN0ZW5BbmRTZXJ2ZSh7IHBvcnQgfSwgKHJlcXVlc3QpID0+IHtcbiAqICAgY29uc3QgYm9keSA9IGBZb3VyIHVzZXItYWdlbnQgaXM6XFxuXFxuJHtyZXF1ZXN0LmhlYWRlcnMuZ2V0KFxuICogICAgIFwidXNlci1hZ2VudFwiLFxuICogICApID8/IFwiVW5rbm93blwifWA7XG4gKlxuICogICByZXR1cm4gbmV3IFJlc3BvbnNlKGJvZHksIHsgc3RhdHVzOiAyMDAgfSk7XG4gKiB9KTtcbiAqIGBgYFxuICpcbiAqIEBwYXJhbSBjb25maWcgVGhlIERlbm8uTGlzdGVuT3B0aW9ucyB0byBzcGVjaWZ5IHRoZSBob3N0bmFtZSBhbmQgcG9ydC5cbiAqIEBwYXJhbSBoYW5kbGVyIFRoZSBoYW5kbGVyIGZvciBpbmRpdmlkdWFsIEhUVFAgcmVxdWVzdHMuXG4gKiBAcGFyYW0gb3B0aW9ucyBPcHRpb25hbCBzZXJ2ZSBvcHRpb25zLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbGlzdGVuQW5kU2VydmUoXG4gIGNvbmZpZzogUGFydGlhbDxEZW5vLkxpc3Rlbk9wdGlvbnM+LFxuICBoYW5kbGVyOiBIYW5kbGVyLFxuICBvcHRpb25zPzogU2VydmVJbml0LFxuKTogUHJvbWlzZTx2b2lkPiB7XG4gIGNvbnN0IHNlcnZlciA9IG5ldyBTZXJ2ZXIoeyAuLi5jb25maWcsIGhhbmRsZXIgfSk7XG5cbiAgb3B0aW9ucz8uc2lnbmFsPy5hZGRFdmVudExpc3RlbmVyKFwiYWJvcnRcIiwgKCkgPT4gc2VydmVyLmNsb3NlKCksIHtcbiAgICBvbmNlOiB0cnVlLFxuICB9KTtcblxuICByZXR1cm4gYXdhaXQgc2VydmVyLmxpc3RlbkFuZFNlcnZlKCk7XG59XG5cbi8qKlxuICogQGRlcHJlY2F0ZWQgVXNlIGBzZXJ2ZVRsc2AgaW5zdGVhZC5cbiAqXG4gKiBDb25zdHJ1Y3RzIGEgc2VydmVyLCBjcmVhdGVzIGEgbGlzdGVuZXIgb24gdGhlIGdpdmVuIGFkZHJlc3MsIGFjY2VwdHNcbiAqIGluY29taW5nIGNvbm5lY3Rpb25zLCB1cGdyYWRlcyB0aGVtIHRvIFRMUywgYW5kIGhhbmRsZXMgcmVxdWVzdHMgb24gdGhlc2VcbiAqIGNvbm5lY3Rpb25zIHdpdGggdGhlIGdpdmVuIGhhbmRsZXIuXG4gKlxuICogSWYgdGhlIHBvcnQgaXMgb21pdHRlZCBmcm9tIHRoZSBMaXN0ZW5PcHRpb25zLCBwb3J0IDQ0MyBpcyB1c2VkLlxuICpcbiAqIElmIHRoZSBob3N0IGlzIG9taXR0ZWQgZnJvbSB0aGUgTGlzdGVuT3B0aW9ucywgdGhlIG5vbi1yb3V0YWJsZSBtZXRhLWFkZHJlc3NcbiAqIGAwLjAuMC4wYCBpcyB1c2VkLlxuICpcbiAqIGBgYHRzXG4gKiBpbXBvcnQgeyBsaXN0ZW5BbmRTZXJ2ZVRscyB9IGZyb20gXCJodHRwczovL2Rlbm8ubGFuZC9zdGRAJFNURF9WRVJTSU9OL2h0dHAvc2VydmVyLnRzXCI7XG4gKlxuICogY29uc3QgcG9ydCA9IDQ1MDU7XG4gKiBjb25zdCBjZXJ0RmlsZSA9IFwiL3BhdGgvdG8vY2VydEZpbGUuY3J0XCI7XG4gKiBjb25zdCBrZXlGaWxlID0gXCIvcGF0aC90by9rZXlGaWxlLmtleVwiO1xuICpcbiAqIGNvbnNvbGUubG9nKFwic2VydmVyIGxpc3RlbmluZyBvbiBodHRwOi8vbG9jYWxob3N0OjQ1MDVcIik7XG4gKlxuICogYXdhaXQgbGlzdGVuQW5kU2VydmVUbHMoeyBwb3J0IH0sIGNlcnRGaWxlLCBrZXlGaWxlLCAocmVxdWVzdCkgPT4ge1xuICogICBjb25zdCBib2R5ID0gYFlvdXIgdXNlci1hZ2VudCBpczpcXG5cXG4ke3JlcXVlc3QuaGVhZGVycy5nZXQoXG4gKiAgICAgXCJ1c2VyLWFnZW50XCIsXG4gKiAgICkgPz8gXCJVbmtub3duXCJ9YDtcbiAqXG4gKiAgIHJldHVybiBuZXcgUmVzcG9uc2UoYm9keSwgeyBzdGF0dXM6IDIwMCB9KTtcbiAqIH0pO1xuICogYGBgXG4gKlxuICogQHBhcmFtIGNvbmZpZyBUaGUgRGVuby5MaXN0ZW5PcHRpb25zIHRvIHNwZWNpZnkgdGhlIGhvc3RuYW1lIGFuZCBwb3J0LlxuICogQHBhcmFtIGNlcnRGaWxlIFRoZSBwYXRoIHRvIHRoZSBmaWxlIGNvbnRhaW5pbmcgdGhlIFRMUyBjZXJ0aWZpY2F0ZS5cbiAqIEBwYXJhbSBrZXlGaWxlIFRoZSBwYXRoIHRvIHRoZSBmaWxlIGNvbnRhaW5pbmcgdGhlIFRMUyBwcml2YXRlIGtleS5cbiAqIEBwYXJhbSBoYW5kbGVyIFRoZSBoYW5kbGVyIGZvciBpbmRpdmlkdWFsIEhUVFAgcmVxdWVzdHMuXG4gKiBAcGFyYW0gb3B0aW9ucyBPcHRpb25hbCBzZXJ2ZSBvcHRpb25zLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbGlzdGVuQW5kU2VydmVUbHMoXG4gIGNvbmZpZzogUGFydGlhbDxEZW5vLkxpc3Rlbk9wdGlvbnM+LFxuICBjZXJ0RmlsZTogc3RyaW5nLFxuICBrZXlGaWxlOiBzdHJpbmcsXG4gIGhhbmRsZXI6IEhhbmRsZXIsXG4gIG9wdGlvbnM/OiBTZXJ2ZUluaXQsXG4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgY29uc3Qgc2VydmVyID0gbmV3IFNlcnZlcih7IC4uLmNvbmZpZywgaGFuZGxlciB9KTtcblxuICBvcHRpb25zPy5zaWduYWw/LmFkZEV2ZW50TGlzdGVuZXIoXCJhYm9ydFwiLCAoKSA9PiBzZXJ2ZXIuY2xvc2UoKSwge1xuICAgIG9uY2U6IHRydWUsXG4gIH0pO1xuXG4gIHJldHVybiBhd2FpdCBzZXJ2ZXIubGlzdGVuQW5kU2VydmVUbHMoY2VydEZpbGUsIGtleUZpbGUpO1xufVxuIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiIwRUFBMEU7QUFDMUUsU0FBUyxLQUFLLFFBQVEsaUJBQWlCLENBQUM7QUFFeEMsaURBQWlELENBQ2pELE1BQU0sbUJBQW1CLEdBQUcsZUFBZSxBQUFDO0FBRTVDLHFDQUFxQyxDQUNyQyxNQUFNLFNBQVMsR0FBRyxFQUFFLEFBQUM7QUFFckIsc0NBQXNDLENBQ3RDLE1BQU0sVUFBVSxHQUFHLEdBQUcsQUFBQztBQUV2Qix5RUFBeUUsQ0FDekUsTUFBTSw0QkFBNEIsR0FBRyxDQUFDLEFBQUM7QUFFdkMsb0VBQW9FLENBQ3BFLE1BQU0sd0JBQXdCLEdBQUcsSUFBSSxBQUFDO0FBb0N0Qyx3Q0FBd0MsQ0FDeEMsT0FBTyxNQUFNLE1BQU07SUFDakIsQ0FBQyxJQUFJLENBQVU7SUFDZixDQUFDLElBQUksQ0FBVTtJQUNmLENBQUMsT0FBTyxDQUFVO0lBQ2xCLENBQUMsTUFBTSxHQUFHLEtBQUssQ0FBQztJQUNoQixDQUFDLFNBQVMsR0FBdUIsSUFBSSxHQUFHLEVBQUUsQ0FBQztJQUMzQyxDQUFDLGVBQWUsR0FBdUIsSUFBSSxHQUFHLEVBQUUsQ0FBQztJQUNqRCxDQUFDLE9BQU8sQ0FBbUQ7SUFFM0Q7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7S0FtQkcsQ0FDSCxZQUFZLFVBQXNCLENBQUU7UUFDbEMsSUFBSSxDQUFDLENBQUMsSUFBSSxHQUFHLFVBQVUsQ0FBQyxJQUFJLENBQUM7UUFDN0IsSUFBSSxDQUFDLENBQUMsSUFBSSxHQUFHLFVBQVUsQ0FBQyxRQUFRLENBQUM7UUFDakMsSUFBSSxDQUFDLENBQUMsT0FBTyxHQUFHLFVBQVUsQ0FBQyxPQUFPLENBQUM7UUFDbkMsSUFBSSxDQUFDLENBQUMsT0FBTyxHQUFHLFVBQVUsQ0FBQyxPQUFPLElBQ2hDLFNBQVUsS0FB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