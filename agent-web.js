const daemon = require('./lib/frame/daemon.js');
const client = require('./lib/frame/client.js');
const http = require('./lib/http');
const fs = require('fs');
const encoding = require("encoding");
const gost89 = require('gost89');
const jk = require('jkurwa');

const algos = gost89.compat.algos;
const Certificate = jk.models.Certificate;
const Priv = jk.models.Priv;
const Box = jk.Box;

const io = {
  stdout: process.stdout,
  readFileSync: fs.readFileSync,
  writeFileSync: fs.writeFileSync,
};

function error(...all) {
  if (io.stderr) {
    all.forEach((path) => io.stderr.write(path));
  } else {
    console.error(...all);
  }
}

function output(filename, data, isWin) {
    if (typeof filename === 'string' && filename !== '-') {
    io.writeFileSync(filename, data);
  } else {
        io.stdout.write(
            isWin ? encoding.convert(data, 'utf-8', 'cp1251') : data
        );
  }
}

function dateStr(d) {
  d = d || new Date();
    return d.toISOString().replace(/[\-T:Z.]/g, '').slice(0, 14);
}

function key_param_parse(key) {
  let pw;
    if (key.indexOf(':') !== -1) {
        pw = key.substr(key.indexOf(':') + 1);
        key = key.substr(0, key.indexOf(':'));
  }
  return {
    path: key,
    pw: pw,
  };
}

function tsp_arg(value) {
  if (value === true) {
        return 'content';
  }
  return value;
}

function listOf(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  return [value];
}

async function get_local_box(key, cert, ca) {
  const box = new Box({ algo: algos(), query: http.query });
  const keyInfo = listOf(key).map(key_param_parse);
  for (let { path, pw } of keyInfo) {
        let buf = fs.readFileSync(path);
    box.load({ keyBuffers: [buf], password: pw });
  }
  for (let path of listOf(cert)) {
        let buf = fs.readFileSync(path);
    box.load({ certPem: buf });
  }
  if (ca) {
        let buf = fs.readFileSync(ca);
    box.loadCAs(buf);
  }

  return box;
}

async function get_local_raw_box(key, pass, cert1, cert2, ca) {
    const box = new Box({algo: algos(), query: http.query});
    box.load({keyBuffers: [key], password: pass});
    box.load({certPem: cert1});
    box.load({certPem: cert2});
    if (ca) {
        box.loadCAs(ca);
    }
    return box;
}

async function do_sc(shouldSign, shouldCrypt, box, inputF, outputF, certRecF, edrpou, email, filename, tax, detached, role, tsp, encode_win, time, data) {
    let content
    if (data) {
        content = data
    } else {
        content = io.readFileSync(inputF);
    }
  let cert_rcrypt;

  if (shouldCrypt) {
        let buf = fs.readFileSync(certRecF || shouldCrypt);
    cert_rcrypt = Certificate.from_asn1(buf).as_pem();
    shouldCrypt = true;
  }

  const ipn_ext = box.keys[0].cert.extension.ipn;
  const subject = box.keys[0].cert.subject;

  let headers;
  if (email && tax) {
    if (filename === undefined) {
            filename = inputF.replace(/\\/g, '/').split('/');
      filename = filename[filename.length - 1];
    }
    headers = {
      CERTYPE: "UA1",
            RCV_NAME: encoding.convert(subject.organizationName, 'cp1251'),
      PRG_TYPE: "TRANSPORT GATE",
      PRG_VER: "1.0.0",
      SND_DATE: dateStr(),
      FILENAME: filename || inputF,
      EDRPOU: edrpou || ipn_ext.EDRPOU,
    };
    if (email) {
      headers.RCV_EMAIL = email;
    }
    if (encode_win) {
            headers.ENCODING = 'WIN';
            content = encoding.convert(content, 'cp1251');
    }
  }

  const pipe = [];
  if (shouldSign === true) {
    pipe.push({
            op: 'sign',
      tax: Boolean(tax),
      detached: Boolean(detached),
      role: role,
      tsp: tsp,
      time: time,
    });
  }
  if (shouldCrypt === true) {
    pipe.push({
            op: 'encrypt',
      forCert: cert_rcrypt,
      addCert: true,
      tax: Boolean(tax),
      role: role,
    });
    pipe.push({
            op: 'sign',
      tax: Boolean(tax),
      detached: Boolean(detached),
      role: role,
      tsp: tsp,
      time: time,
    });
  }
  const tb = await box.pipe(content, pipe, headers);
    if (!data) {
  output(outputF, tb);
    }
    box.sock && box.sock.destroy();
    return tb;
}

async function do_parse(inputF, outputF, box, tsp, ocsp, data) {
    let content, content2 = null;
    if (data) {
        content = data;
    } else {
        if (typeof inputF === 'string') {
            content = io.readFileSync(inputF);
        } else {
            content = io.readFileSync(inputF[0]);
            content2 = io.readFileSync(inputF[1]);
        }
    }

    let textinfo
    try {
        textinfo = await box.unwrap(content, content2, {tsp, ocsp})
    } catch (err) {
        console.log(err)
  }

    let rpipe
    try {
        rpipe = (textinfo.pipe || []);
    } catch (err) {
        console.log(err)
    }

  let isWin = false;
  let isErr = false;
    try {
  rpipe.forEach(function (step) {
    const x = step.cert;
    const tr = (step.transport ? step.headers : {}) || {};
    if (step.error) {
      isErr = true;
      error("Error occured during unwrap: " + step.error);
      return;
    }
            if (tr.ENCODING === 'WIN') {
      isWin = true;
                Object.keys(tr).forEach(key => {
                    tr[key] = encoding.convert(tr[key], 'utf8', 'cp1251').toString();
      });
    }
            // if (tr.SUBJECT) {
            //     error('Subject:', tr.SUBJECT);
            // }
            // if (tr.FILENAME) {
            //     error("Filename:", tr.FILENAME);
            // }
            // if (tr.EDRPOU) {
            //     error('Sent-By-EDRPOU:', tr.EDRPOU);
            // }
            // if (step.signed) {
            //     error('Signed-By:', x.subject.commonName || x.subject.organizationName);
            //     if (x.extension.ipn && x.extension.ipn.EDRPOU) {
            //         error('Signed-By-EDRPOU:', x.extension.ipn.EDRPOU);
            //     }
            // }
            // if (step.signed && !step.cert.verified) {
            //     error('Signer-Authentity:', 'Not-Verified');
            //     error('Signer-Authentity-Reason:', 'No CA list supplied');
            // }
            // if (step.ocsp) {
            //     for (let ocsp of step.ocsp) {
            //         error('OCSP-Check:', ocsp.statusOk ? 'OK' : ocsp.requestOk ? 'Fail' : 'Unknown');
            //         if (ocsp.hasOwnProperty('time')) {
            //             error('OCSP-Check-Time:', ocsp.time);
            //         }
            //     }
            // }
            // if (step.contentTime) {
            //     error('Content-Time-TSP:', step.contentTime / 1000);
            // }
            // if (step.tokenTime) {
            //     error('Signature-Time-TSP:', step.tokenTime / 1000);
            // }
            // if (step.signingTime) {
            //     error('Signature-Time:', step.signingTime / 1000);
            // }

    if (step.enc) {
      error("Encrypted");
    }
  });
    } catch (err) {
        console.log(err)
    }

    if (isErr === false && outputF) {
    output(outputF, textinfo.content, isWin);
  }


    if (box.sock) {
        box.sock.destroy();
}

    return textinfo.content
}

function unprotect(argv) {
    try {
        const store = Priv.from_protected(argv.rawKey, argv.pass, algos());
        //проверяем на корректность распакованный ключ. Если будет ошибка - вылетит исключение
  store.keys.forEach(function (key) {
            // output(argv.output, key.as_pem());
  });

  return true;
    } catch (e) {
        // console.log(e);
}
    return false;
}


async function main(argv, setIo) {
  setIo && Object.assign(io, setIo);

  if (argv.unprotect) {
        return unprotect(argv);
  }

  let box;
    try {
  if (argv.connect) {
    box = await new Promise(client.remoteBox);
  } else {
            if (argv.rawKey) {
                box = await get_local_raw_box(argv.rawKey, argv.pass, argv.rawCert1, argv.rawCert2, argv.rawCa);
            } else {
    box = await get_local_box(argv.key, argv.cert, argv.ca_path);
  }
        }
    } catch (err) {
        console.log(err)
    }

  if (argv.sign || argv.crypt) {
    if (argv.crypt === true && !argv.recipient_cert) {
            return error('Please specify recipient certificate for encryption mode: --crypt filename.cert');
    }
        return await do_sc(argv.sign, argv.crypt, box, argv.input, argv.output, argv.recipient_cert, argv.edrpou, argv.email, argv.filename, argv.tax, argv.detached, argv.role, tsp_arg(argv.tsp), argv.encode_win, argv.time && Number(argv.time), argv.data)
  }

  if (argv.decrypt) {
        return await do_parse(argv.input, argv.output, box, tsp_arg(argv.tsp), argv.ocsp, argv.data);
  }

  if (argv.agent && !argv.connect) {
    return daemon.start({ box, silent: argv.silent });
  }
  }

module.exports = {main};
