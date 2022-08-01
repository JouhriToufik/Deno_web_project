// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// This module is browser compatible.
import { deferred } from "./deferred.ts";
export class DeadlineError extends Error {
    constructor(){
        super("Deadline");
        this.name = "DeadlineError";
    }
}
/**
 * Create a promise which will be rejected with DeadlineError when a given delay is exceeded.
 */ export function deadline(p, delay) {
    const d = deferred();
    const t = setTimeout(()=>d.reject(new DeadlineError())
    , delay);
    return Promise.race([
        p,
        d
    ]).finally(()=>clearTimeout(t)
    );
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIiJdLCJzb3VyY2VzQ29udGVudCI6WyIvLyBDb3B5cmlnaHQgMjAxOC0yMDIyIHRoZSBEZW5vIGF1dGhvcnMuIEFsbCByaWdodHMgcmVzZXJ2ZWQuIE1JVCBsaWNlbnNlLlxuLy8gVGhpcyBtb2R1bGUgaXMgYnJvd3NlciBjb21wYXRpYmxlLlxuXG5pbXBvcnQgeyBkZWZlcnJlZCB9IGZyb20gXCIuL2RlZmVycmVkLnRzXCI7XG5cbmV4cG9ydCBjbGFzcyBEZWFkbGluZUVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICBjb25zdHJ1Y3RvcigpIHtcbiAgICBzdXBlcihcIkRlYWRsaW5lXCIpO1xuICAgIHRoaXMubmFtZSA9IFwiRGVhZGxpbmVFcnJvclwiO1xuICB9XG59XG5cbi8qKlxuICogQ3JlYXRlIGEgcHJvbWlzZSB3aGljaCB3aWxsIGJlIHJlamVjdGVkIHdpdGggRGVhZGxpbmVFcnJvciB3aGVuIGEgZ2l2ZW4gZGVsYXkgaXMgZXhjZWVkZWQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkZWFkbGluZTxUPihwOiBQcm9taXNlPFQ+LCBkZWxheTogbnVtYmVyKTogUHJvbWlzZTxUPiB7XG4gIGNvbnN0IGQgPSBkZWZlcnJlZDxuZXZlcj4oKTtcbiAgY29uc3QgdCA9IHNldFRpbWVvdXQoKCkgPT4gZC5yZWplY3QobmV3IERlYWRsaW5lRXJyb3IoKSksIGRlbGF5KTtcbiAgcmV0dXJuIFByb21pc2UucmFjZShbcCwgZF0pLmZpbmFsbHkoKCkgPT4gY2xlYXJUaW1lb3V0KHQpKTtcbn1cbiJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiMEVBQTBFO0FBQzFFLHFDQUFxQztBQUVyQyxTQUFTLFFBQVEsUUFBUSxlQUFlLENBQUM7QUFFekMsT0FBTyxNQUFNLGFBQWEsU0FBUyxLQUFLO0lBQ3RDLGFBQWM7UUFDWixLQUFLLENBQUMsVUFBVSxDQUFDLENBQUM7UUFDbEIsSUFBSSxDQUFDLElBQUksR0FBRyxlQUFlLENBQUM7S0FDN0I7Q0FDRjtBQUVEOztHQUVHLENBQ0gsT0FBTyxTQUFTLFFBQVEsQ0FBSSxDQUFhLEVBQUUsS0FBYSxFQUFjO0lBQ3BFLE1BQU0sQ0FBQyxHQUFHLFFBQVEsRUFBUyxBQUFDO0lBQzVCLE1BQU0sQ0FBQyxHQUFHLFVBQVUsQ0FBQyxJQUFNLENBQUMsQ0FBQyxNQUFNLENBQUMsSUFBSSxhQUFhLEVBQUUsQ0FBQztJQUFBLEVBQUUsS0FBSyxDQUFDLEFBQUM7SUFDakUsT0FBTyxPQUFPLENBQUMsSUFBSSxDQUFDO1FBQUMsQ0FBQztRQUFFLENBQUM7S0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLElBQU0sWUFBWSxDQUFDLENBQUMsQ0FBQztJQUFBLENBQUMsQ0FBQztDQUM1RCJ9