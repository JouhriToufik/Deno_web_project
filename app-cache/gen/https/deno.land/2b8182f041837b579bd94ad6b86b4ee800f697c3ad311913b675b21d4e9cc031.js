/**
 * Creates a debounced function that delays the given `func`
 * by a given `wait` time in milliseconds. If the method is called
 * again before the timeout expires, the previous call will be
 * aborted.
 *
 * ```
 * import { debounce } from "./debounce.ts";
 *
 * const log = debounce(
 *   (event: Deno.FsEvent) =>
 *     console.log("[%s] %s", event.kind, event.paths[0]),
 *   200,
 * );
 *
 * for await (const event of Deno.watchFs("./")) {
 *   log(event);
 * }
 * ```
 *
 * @param fn    The function to debounce.
 * @param wait  The time in milliseconds to delay the function.
 */ // deno-lint-ignore no-explicit-any
export function debounce(fn, wait) {
    let timeout = null;
    let flush = null;
    const debounced = (...args)=>{
        debounced.clear();
        flush = ()=>{
            debounced.clear();
            fn.call(debounced, ...args);
        };
        timeout = setTimeout(flush, wait);
    };
    debounced.clear = ()=>{
        if (typeof timeout === "number") {
            clearTimeout(timeout);
            timeout = null;
            flush = null;
        }
    };
    debounced.flush = ()=>{
        flush?.();
    };
    Object.defineProperty(debounced, "pending", {
        get: ()=>typeof timeout === "number"
    });
    return debounced;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIiJdLCJzb3VyY2VzQ29udGVudCI6WyIvLyBDb3B5cmlnaHQgMjAxOC0yMDIyIHRoZSBEZW5vIGF1dGhvcnMuIEFsbCByaWdodHMgcmVzZXJ2ZWQuIE1JVCBsaWNlbnNlLlxuLy8gVGhpcyBtb2R1bGUgaXMgYnJvd3NlciBjb21wYXRpYmxlLlxuXG4vKipcbiAqIEEgZGVib3VuY2VkIGZ1bmN0aW9uIHRoYXQgd2lsbCBiZSBkZWxheWVkIGJ5IGEgZ2l2ZW4gYHdhaXRgXG4gKiB0aW1lIGluIG1pbGxpc2Vjb25kcy4gSWYgdGhlIG1ldGhvZCBpcyBjYWxsZWQgYWdhaW4gYmVmb3JlXG4gKiB0aGUgdGltZW91dCBleHBpcmVzLCB0aGUgcHJldmlvdXMgY2FsbCB3aWxsIGJlIGFib3J0ZWQuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRGVib3VuY2VkRnVuY3Rpb248VCBleHRlbmRzIEFycmF5PHVua25vd24+PiB7XG4gICguLi5hcmdzOiBUKTogdm9pZDtcbiAgLyoqIENsZWFycyB0aGUgZGVib3VuY2UgdGltZW91dCBhbmQgb21pdHMgY2FsbGluZyB0aGUgZGVib3VuY2VkIGZ1bmN0aW9uLiAqL1xuICBjbGVhcigpOiB2b2lkO1xuICAvKiogQ2xlYXJzIHRoZSBkZWJvdW5jZSB0aW1lb3V0IGFuZCBjYWxscyB0aGUgZGVib3VuY2VkIGZ1bmN0aW9uIGltbWVkaWF0ZWx5LiAqL1xuICBmbHVzaCgpOiB2b2lkO1xuICAvKiogUmV0dXJucyBhIGJvb2xlYW4gd2V0aGVyIGEgZGVib3VuY2UgY2FsbCBpcyBwZW5kaW5nIG9yIG5vdC4gKi9cbiAgcmVhZG9ubHkgcGVuZGluZzogYm9vbGVhbjtcbn1cblxuLyoqXG4gKiBDcmVhdGVzIGEgZGVib3VuY2VkIGZ1bmN0aW9uIHRoYXQgZGVsYXlzIHRoZSBnaXZlbiBgZnVuY2BcbiAqIGJ5IGEgZ2l2ZW4gYHdhaXRgIHRpbWUgaW4gbWlsbGlzZWNvbmRzLiBJZiB0aGUgbWV0aG9kIGlzIGNhbGxlZFxuICogYWdhaW4gYmVmb3JlIHRoZSB0aW1lb3V0IGV4cGlyZXMsIHRoZSBwcmV2aW91cyBjYWxsIHdpbGwgYmVcbiAqIGFib3J0ZWQuXG4gKlxuICogYGBgXG4gKiBpbXBvcnQgeyBkZWJvdW5jZSB9IGZyb20gXCIuL2RlYm91bmNlLnRzXCI7XG4gKlxuICogY29uc3QgbG9nID0gZGVib3VuY2UoXG4gKiAgIChldmVudDogRGVuby5Gc0V2ZW50KSA9PlxuICogICAgIGNvbnNvbGUubG9nKFwiWyVzXSAlc1wiLCBldmVudC5raW5kLCBldmVudC5wYXRoc1swXSksXG4gKiAgIDIwMCxcbiAqICk7XG4gKlxuICogZm9yIGF3YWl0IChjb25zdCBldmVudCBvZiBEZW5vLndhdGNoRnMoXCIuL1wiKSkge1xuICogICBsb2coZXZlbnQpO1xuICogfVxuICogYGBgXG4gKlxuICogQHBhcmFtIGZuICAgIFRoZSBmdW5jdGlvbiB0byBkZWJvdW5jZS5cbiAqIEBwYXJhbSB3YWl0ICBUaGUgdGltZSBpbiBtaWxsaXNlY29uZHMgdG8gZGVsYXkgdGhlIGZ1bmN0aW9uLlxuICovXG4vLyBkZW5vLWxpbnQtaWdub3JlIG5vLWV4cGxpY2l0LWFueVxuZXhwb3J0IGZ1bmN0aW9uIGRlYm91bmNlPFQgZXh0ZW5kcyBBcnJheTxhbnk+PihcbiAgZm46ICh0aGlzOiBEZWJvdW5jZWRGdW5jdGlvbjxUPiwgLi4uYXJnczogVCkgPT4gdm9pZCxcbiAgd2FpdDogbnVtYmVyLFxuKTogRGVib3VuY2VkRnVuY3Rpb248VD4ge1xuICBsZXQgdGltZW91dDogbnVtYmVyIHwgbnVsbCA9IG51bGw7XG4gIGxldCBmbHVzaDogKCgpID0+IHZvaWQpIHwgbnVsbCA9IG51bGw7XG5cbiAgY29uc3QgZGVib3VuY2VkOiBEZWJvdW5jZWRGdW5jdGlvbjxUPiA9ICgoLi4uYXJnczogVCk6IHZvaWQgPT4ge1xuICAgIGRlYm91bmNlZC5jbGVhcigpO1xuICAgIGZsdXNoID0gKCk6IHZvaWQgPT4ge1xuICAgICAgZGVib3VuY2VkLmNsZWFyKCk7XG4gICAgICBmbi5jYWxsKGRlYm91bmNlZCwgLi4uYXJncyk7XG4gICAgfTtcbiAgICB0aW1lb3V0ID0gc2V0VGltZW91dChmbHVzaCwgd2FpdCk7XG4gIH0pIGFzIERlYm91bmNlZEZ1bmN0aW9uPFQ+O1xuXG4gIGRlYm91bmNlZC5jbGVhciA9ICgpOiB2b2lkID0+IHtcbiAgICBpZiAodHlwZW9mIHRpbWVvdXQgPT09IFwibnVtYmVyXCIpIHtcbiAgICAgIGNsZWFyVGltZW91dCh0aW1lb3V0KTtcbiAgICAgIHRpbWVvdXQgPSBudWxsO1xuICAgICAgZmx1c2ggPSBudWxsO1xuICAgIH1cbiAgfTtcblxuICBkZWJvdW5jZWQuZmx1c2ggPSAoKTogdm9pZCA9PiB7XG4gICAgZmx1c2g/LigpO1xuICB9O1xuXG4gIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShkZWJvdW5jZWQsIFwicGVuZGluZ1wiLCB7XG4gICAgZ2V0OiAoKSA9PiB0eXBlb2YgdGltZW91dCA9PT0gXCJudW1iZXJcIixcbiAgfSk7XG5cbiAgcmV0dXJuIGRlYm91bmNlZDtcbn1cbiJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFrQkE7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FzQkcsQ0FDSCxtQ0FBbUM7QUFDbkMsT0FBTyxTQUFTLFFBQVEsQ0FDdEIsRUFBb0QsRUFDcEQsSUFBWSxFQUNVO0lBQ3RCLElBQUksT0FBTyxHQUFrQixJQUFJLEFBQUM7SUFDbEMsSUFBSSxLQUFLLEdBQXdCLElBQUksQUFBQztJQUV0QyxNQUFNLFNBQVMsR0FBMEIsQ0FBQyxHQUFHLElBQUksQUFBRyxHQUFXO1FBQzdELFNBQVMsQ0FBQyxLQUFLLEVBQUUsQ0FBQztRQUNsQixLQUFLLEdBQUcsSUFBWTtZQUNsQixTQUFTLENBQUMsS0FBSyxFQUFFLENBQUM7WUFDbEIsRUFBRSxDQUFDLElBQUksQ0FBQyxTQUFTLEtBQUssSUFBSSxDQUFDLENBQUM7U0FDN0IsQ0FBQztRQUNGLE9BQU8sR0FBRyxVQUFVLENBQUMsS0FBSyxFQUFFLElBQUksQ0FBQyxDQUFDO0tBQ25DLEFBQXlCLEFBQUM7SUFFM0IsU0FBUyxDQUFDLEtBQUssR0FBRyxJQUFZO1FBQzVCLElBQUksT0FBTyxPQUFPLEtBQUssUUFBUSxFQUFFO1lBQy9CLFlBQVksQ0FBQyxPQUFPLENBQUMsQ0FBQztZQUN0QixPQUFPLEdBQUcsSUFBSSxDQUFDO1lBQ2YsS0FBSyxHQUFHLElBQUksQ0FBQztTQUNkO0tBQ0YsQ0FBQztJQUVGLFNBQVMsQ0FBQyxLQUFLLEdBQUcsSUFBWTtRQUM1QixLQUFLLElBQUksQ0FBQztLQUNYLENBQUM7SUFFRixNQUFNLENBQUMsY0FBYyxDQUFDLFNBQVMsRUFBRSxTQUFTLEVBQUU7UUFDMUMsR0FBRyxFQUFFLElBQU0sT0FBTyxPQUFPLEtBQUssUUFBUTtLQUN2QyxDQUFDLENBQUM7SUFFSCxPQUFPLFNBQVMsQ0FBQztDQUNsQiJ9