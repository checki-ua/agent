const express = require('express')
const app = express();
const agent = require("./agent-web");

var argv = require('yargs')
    .option('port', {default: 3001})
    .argv;
const port = argv.port ? argv.port : 3001;

app.get('/', (request, response) => {
    response.send('Hello from Express!')
})

app.use(express.json({limit: '25mb'}))
app.use(express.urlencoded({extended: true, limit: '25mb'}))

app.post('/sign', (request, response) => {
    let result
    var argv = require('yargs')
        .usage('Sign, encrypt or decrypt UASIGN files')
        .option('tsp', {default: false})
        .option('tax', {default: true})
        .option('detached', {default: false})
        .option('role', {default: 'director'})
        .argv;

    argv.sign = true
    argv.path = request.query['key']
    argv.pass = request.query['pass']
    argv.key = argv.path + ':' + argv.pass
    argv.cert = request.query['cert']
    argv.role = request.query['role']
    argv.tax = false
    argv.tsp = 'signature'
    argv.input = request.query['input']
    argv.output = request.query['output']

    argv.rawKey = Buffer.from(request.body.rawKey, 'base64')
    argv.rawCert1 = Buffer.from(request.body.rawCert1, 'base64')
    argv.rawCert2 = Buffer.from(request.body.rawCert2, 'base64')

    argv.data = Buffer.from(request.body.data, 'base64')

    agent.main(argv).then((result) => {
    let res = result.toString('base64');
    console.log("Data signed. Port " + port + " \n");
        response.send(res)
});
})

app.post('/decrypt', (request, response) => {
    var argv = require('yargs')
        .usage('Sign, encrypt or decrypt UASIGN files')
        .option('tsp', {default: false})
        .option('tax', {default: true})
        .option('detached', {default: false})
        .option('role', {default: 'director'})
        .argv;

    argv.decrypt = true
    argv.path = request.query['key']
    argv.pass = request.query['pass']
    argv.key = argv.path + ':' + argv.pass
    argv.cert = request.query['cert']
    argv.role = request.query['role']
    // argv.ocsp = 'strict'
    argv.tsp = 'signature'
    argv.input = request.query['input']
    argv.output = request.query['output']

    argv.rawKey = Buffer.from(request.body.rawKey, 'base64')
    argv.rawCert1 = Buffer.from(request.body.rawCert1, 'base64')
    argv.rawCert2 = Buffer.from(request.body.rawCert2, 'base64')
    argv.rawCa = Buffer.from(request.body.rawCa, 'base64')

    argv.data = Buffer.from(request.body.data, 'base64')

    const agent = require('./agent');

    agent.main(argv).then((result) => {
        if (result) {
            let res = result.toString('base64');
            console.log("Data decrypted. \n")
            response.send(res)
        }
    }).catch((result) => {
        console.log('Some error happens!' + result.errorDetail)
    });

});

app.post('/key-unwrap', (request, response) => {
    var argv = require('yargs')
        .usage('Sign, encrypt or decrypt UASIGN files')
        .option('tsp', {default: false})
        .option('tax', {default: true})
        .option('detached', {default: false})
        .option('role', {default: 'director'})
        .argv;

    argv.unprotect = true;
    argv.path = request.query['key'];
    argv.key = argv.path + ':' + request.query['pass'];
    argv.output = request.query['output'];
    argv.pass = request.query['pass'];
    argv.rawKey = Buffer.from(request.body.rawKey, 'base64');

    const agent = require('./agent');

    agent.main(argv).then((result) => {
        console.log('Key verified. Result: ' + result);
        response.send({result: result});
    }).catch((result) => {
        console.log('Some error happens!' + result.errorDetail);
        response.send({result: false, message: 'Some error happens!' + result.errorDetail})
    });

});

app.listen(port, (err) => {
    if (err) {
        return console.log('something bad happened', err)
    }
    console.log(`server is listening on ${port}`)
});