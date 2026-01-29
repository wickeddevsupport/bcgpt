import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { handleMCP } from "./mcp.js";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const UA = "bcgpt-production";

let TOKEN = null;
let IDENTITY = null;
let ACCOUNT = null;

app.get("/auth/basecamp/start", async (req,res)=>{
  const url = `https://launchpad.37signals.com/authorization/new?type=web_server&client_id=${process.env.BASECAMP_CLIENT_ID}&redirect_uri=${process.env.APP_BASE_URL}/auth/basecamp/callback`;
  res.redirect(url);
});

app.get("/auth/basecamp/callback", async (req,res)=>{
  const r = await fetch("https://launchpad.37signals.com/authorization/token",{
    method:"POST",
    headers:{ "Content-Type":"application/json","User-Agent":UA },
    body:JSON.stringify({
      type:"web_server",
      client_id:process.env.BASECAMP_CLIENT_ID,
      client_secret:process.env.BASECAMP_CLIENT_SECRET,
      redirect_uri:`${process.env.APP_BASE_URL}/auth/basecamp/callback`,
      code:req.query.code
    })
  });
  TOKEN = await r.json();

  const auth = await fetch("https://launchpad.37signals.com/authorization.json",{
    headers:{Authorization:`Bearer ${TOKEN.access_token}`,"User-Agent":UA}
  }).then(r=>r.json());

  IDENTITY = auth.identity;
  ACCOUNT = auth.accounts[0];
  res.send("Basecamp connected. Return to ChatGPT.");
});

app.post("/mcp", async (req,res)=>{
  const authLink = `${process.env.APP_BASE_URL}/auth/basecamp/start`;
  const result = await handleMCP(req.body,{
    token:TOKEN,
    identity:IDENTITY,
    account:ACCOUNT,
    authLink
  });
  res.json(result);
});

app.listen(PORT,()=>console.log("bcgpt-production running on",PORT));
