// Serve the release artifact with production-like static headers for offline QA.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve('dist'),prefix='/rikkyo-uk-vocab';
const mime={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/favicon.ico')return res.writeHead(204).end();
 if(!url.pathname.startsWith(prefix+'/'))return res.writeHead(404).end();
 const relative=decodeURIComponent(url.pathname.slice(prefix.length));
 const file=path.resolve(root,'.'+relative,relative==='/'?'index.html':'');
 if(!file.startsWith(root+path.sep))return res.writeHead(403).end();
 try{res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));}catch{res.writeHead(404).end();}
}).listen(Number(process.env.QA_PORT||4173),'127.0.0.1',()=>console.log('Release artifact ready'));
