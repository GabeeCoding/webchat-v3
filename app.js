const http = require("http")
const express = require("express")
const socketio = require("socket.io")
const CryptoJS = require("crypto-js")
const crypto = require("crypto")

const app = express()
const server = http.createServer(app)
const io = new socketio.Server(server, {cors: {origin: "*"}})
io.listen(server)

//generate key pair
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
	modulusLength: 1024,
	publicKeyEncoding: {
		type: 'spki',
		format: 'pem'
	},
	privateKeyEncoding: {
		type: 'pkcs8',
		format: 'pem',
	}
})

const publicKeyHash = crypto.createHash("sha256")
publicKeyHash.update(publicKey)
const publicKeyChecksum = publicKeyHash.digest("hex")
console.log("public key checksum", publicKeyChecksum)

console.log(publicKey)

let usernames = {}

app.use((req, resp, next) => {
	resp.header('Access-Control-Allow-Origin', req.get('Origin') || '*');
	if (req.method === 'OPTIONS') {
		return res.send(200);
	} else {
		return next();
	}
})

app.use(express.static("public"))

app.use((req, res, next) => {
	var data='';
	req.setEncoding('utf8');
	req.on('data', function(chunk) { 
		data += chunk;
	});

	req.on('end', function() {
		req.body = data;
		next();
	});
});

app.get("/publickeychecksum", (req, resp) => {
	resp.send(publicKeyChecksum)
})

app.get("/publickey", (req, resp) => {
	resp.send(publicKey)
})

app.get("/usercount", (req, resp) => {
	resp.send(usernames.length.toString())
})

io.on("connection", socket => {
	let sid = socket.id
	usernames[sid] = {}

	const encrypt = data => {
		//encrypt AES
		return CryptoJS.AES.encrypt(text, usernames[sid]["aesKey"]).toString()
	}

	const disconnect = () => {
		socket.disconnect()
		usernames[sid] = undefined
	}

	socket.on("encryptedKey", encrypted => {
		//string data
		let decrypted
		try {
			decrypted = crypto.privateDecrypt({ key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(encrypted, "base64")).toString()
		} catch (err){
			console.error("handled exception: error decrypting aes key")
			console.error(err)
			//TODO for client
			socket.emit("decryptKeyFailed")
			disconnect()
			return
		}
		console.log("done")
		console.log(decrypted)
		if(usernames[sid]["aesKey"] !== undefined){
			console.error("aes key already exists")
			return
		}
		usernames[sid]["aesKey"] = decrypted
	})

	const decryptData = encrypted => {
		if(!encrypted || usernames[sid]["aesKey"] === undefined){
			disconnect()
			return
		}
		return CryptoJS.AES.decrypt(encrypted, usernames[sid]["aesKey"]).toString(CryptoJS.enc.Utf8)
	}

	socket.on("assignUsername", encrypted => {
		let data = decryptData(encrypted)
		//TODO check for username length and attempts to switch twice
		const duplicate_recursive = username => {
			for (const v of Object.values(usernames)) {
				if(v["username"] !== undefined && v["username"] === username){
					return duplicate_recursive(username + " (duplicate")
				}
			}
			return username
		})
		let username = duplicate_recursive(data)
		usernames[sid]["username"] = username
		io.to(sid).emit("systemMessage", encrypt("Username set to " + username))
		console.log(usernames)
	})
	
	socket.on("switchChannel", encrypted => {
		let data = decryptData(encrypted)
		if(data === ""){
			
		}

	})

	socket.on("disconnect", () => {
		console.log(`${sid} disconnected`)
		if(usernames[sid] !== undefined){
			//TODO, send message to channel
		}
		usernames[sid] = undefined

	})
})

const PORT = process.env.PORT || 3000
server.listen(PORT, () => console.log(`Listening on port ${PORT}`))
