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

app.post("/connect", (req, resp) => {
	//step 2, client sends encrypted session key with our public key
	//decrypt it with the private key
	console.log("got encrypted data")
	let encrypted = req.body
	console.log(encrypted)
	let decrypted = crypto.privateDecrypt({ key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(encrypted, "base64")).toString()
	console.log("decrypting...")
	console.log(decrypted)

})

app.get("/publickeychecksum", (req, resp) => {
	resp.send(publicKeyChecksum)
})

app.get("/publickey", (req, resp) => {
	resp.send(publicKey)
})

io.on("connection", socket => {
	let sid = socket.id
	//connected
	socket.on("handshake", arg => {
		console.log("handshake init")
		console.log(arg)
	})
})

const PORT = process.env.PORT || 3000
server.listen(PORT, () => console.log(`Listening on port ${PORT}`))
