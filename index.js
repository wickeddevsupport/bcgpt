
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { basecampFetch } from "./basecamp.js";
import { handleMCP } from "./mcp.js";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

let TOKEN=null, AUTH_CACHE=null;

async function getAuth(force=false){
  if(!TOKEN) throw new Error("NOT_AUTHENTICATED");
  if(AUTH_CACHE && !force) return AUTH_CACHE;
  const r=await fetch("https://launchpad.37signals.com/authorization.json",{
    headers:{Authorization:`Bearer ${TOKEN.access_token}`}
  });
  AUTH_CACHE=await r.json();
  return AUTH_CACHE;
}

async function getAccountId(){
  const auth=await getAuth();
  return auth.accounts[0].id;
}

// Tier 0
app.get("/health",(r,s)=>s.json({ok:true}));
app.get("/auth/basecamp/start",(r,s)=>{
  s.redirect(`https://launchpad.37signals.com/authorization/new?type=web_server&client_id=${process.env.BASECAMP_CLIENT_ID}&redirect_uri=${process.env.APP_BASE_URL}/auth/basecamp/callback`);
});
app.get("/auth/basecamp/callback",async(req,res)=>{
  const r=await fetch("https://launchpad.37signals.com/authorization/token",{
    method:"POST",
    headers:{ "Content-Type":"application/x-www-form-urlencoded" },
    body:new URLSearchParams({
      type:"web_server",
      client_id:process.env.BASECAMP_CLIENT_ID,
      client_secret:process.env.BASECAMP_CLIENT_SECRET,
      redirect_uri:`${process.env.APP_BASE_URL}/auth/basecamp/callback`,
      code:req.query.code
    })
  });
  TOKEN=await r.json(); AUTH_CACHE=null;
  res.send("Connected");
});
app.get("/startbcgpt",async(req,res)=>{
  if(!TOKEN) return res.json({connected:false});
  const a=await getAuth(true);
  res.json({connected:true,user:{name:a.identity.name,email:a.identity.email_address}});
});
app.post("/logout",(r,s)=>{TOKEN=null;AUTH_CACHE=null;s.json({ok:true});});

// Tier 1–6 REST (all checklist endpoints)
app.get("/projects",async(r,s)=>s.json(await basecampFetch(TOKEN,`/${await getAccountId()}/projects.json`)));
app.get("/projects/:id/people",async(r,s)=>s.json(await basecampFetch(TOKEN,`/buckets/${r.params.id}/people.json`)));
app.get("/projects/:id/todolists",async(r,s)=>s.json(await basecampFetch(TOKEN,`/buckets/${r.params.id}/todolists.json`)));
app.get("/projects/:id/message_boards",async(r,s)=>s.json(await basecampFetch(TOKEN,`/buckets/${r.params.id}/message_boards.json`)));
app.get("/projects/:id/documents",async(r,s)=>s.json(await basecampFetch(TOKEN,`/buckets/${r.params.id}/documents.json`)));
app.get("/projects/:id/attachments",async(r,s)=>s.json(await basecampFetch(TOKEN,`/buckets/${r.params.id}/attachments.json`)));
app.get("/projects/:id/campfires",async(r,s)=>s.json(await basecampFetch(TOKEN,`/buckets/${r.params.id}/campfires.json`)));

// MCP
app.post("/mcp", async (req,res)=>{
  try {
    const accountId=await getAccountId();
    res.json(await handleMCP(req.body,{TOKEN,accountId}));
  } catch(e) {
    res.json({error:e});
  }
});

app.listen(process.env.PORT||3000,()=>console.log("bcgpt-full running"));
