import { serve } from "https://deno.land/std@0.140.0/http/server.ts";


const app = new Application();
const session = new Session();


const handleRequest = async (request) => {
  console.log("Responding with Hello world!");
  return new Response("Hello wora ld! aa");
};

serve(handleRequest, { port: 7777 });
