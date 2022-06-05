const speech = require("@google-cloud/speech");
const client = new speech.SpeechClient();
const fs = require("fs");
const multer = require("multer");
var FormData = require("form-data");
const ffmpeg = require("./ffmpeg");
var express = require("express");
var app = express();
const axios = require("axios");
const path = require("path");

const toHHMMSS = (secs) => {
  const sec_num = parseInt(secs, 10);
  const hours = Math.floor(sec_num / 3600);
  const minutes = Math.floor(sec_num / 60) % 60;
  const seconds = sec_num % 60;

  return [hours, minutes, seconds]
    .map((v) => (v < 10 ? "0" + v : v))
    .filter((v, i) => v !== "00" || i > 0)
    .join(":");
};

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname);
  },
});
var upload = multer({ storage: storage });

const getTime = () => {
  let date = new Date().toISOString();
  date = date
    .replace("T", " ")
    .replace("Z", "")
    .slice(0, date.length - 5);
  return date;
};

async function convertFile(inputFile, saveFile) {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(inputFile)
      .save(saveFile)
      .on("end", () => resolve(saveFile));
  });
}

async function googleSpeech(filePath, languageCode = "ja-JP") {
  return new Promise(async (resolve, reject) => {
    let sampleRateHertz;
    let encoding;
    let audioChannelCount;
    const language = "ja-JP";
    let extention = filePath.split(".")[2];

    const audio = {
      content: fs.readFileSync(filePath).toString("base64"),
    };
    if (extention !== "mp3") {
      audioChannelCount = 2;
      encoding = "LINEAR16";
      sampleRateHertz = 44100;
    } else {
      encoding = "MP3";
      sampleRateHertz = 48000;
      audioChannelCount = 2;
    }
    const config = {
      audioChannelCount: audioChannelCount,
      encoding: encoding,
      sampleRateHertz: sampleRateHertz,
      languageCode: language,
    };
    const request = {
      config: config,
      audio: audio,
    };

    const [response] = await client.recognize(request);
    // const transcription = response.results.map((item, index) => {
    //   return {
    //     begin: getTime(),
    //     end: getTime(),
    //     content: item.alternatives[0].transcript,
    //     timestamp: !index
    //       ? toHHMMSS(0)
    //       : toHHMMSS(
    //           parseInt(response.results[index - 1].resultEndTime.seconds) + 1
    //         ),
    //   };
    // });

    let data = {
      recordItems: response.results.map((item, index) => {
        return {
          begin: getTime(),
          end: getTime(),
          content: item.alternatives[0].transcript,
          timestamp: !index
            ? toHHMMSS(0)
            : toHHMMSS(
                parseInt(response.results[index - 1].resultEndTime.seconds) + 1
              ),
        };
      }),
      begin: getTime(),
      end: getTime(),
      // file: fs.createReadStream(path.resolve(__dirname, filePath)),
    };
    resolve({ data });
  });
}

const login = async (email, password) => {
  const res = await axios.post("https://nooto.zen-s.com/api/v1/login", {
    email: email,
    password: password,
  });
  const token = res.data.access_token;
  const cookie = res.headers["set-cookie"][0];
  return { token, cookie };
};

const googleLogin = async (data) => {
  const res = await axios.post(
    "https://nooto.zen-s.com/api/v1/google/create",
    JSON.parse(data)
  );
  const token = res.data.access_token;
  const cookie = res.headers["set-cookie"][0];
  return { token, cookie };
};

app.get("/nooto", (req, res) => {
  res.send("Run");
});

app.post("/importRecord", upload.single("file"), async (req, res) => {
  try {
    let filename = req.file.originalname.split(".")[0];
    let extention = req.file.originalname.split(".")[1];
    let filePath;
    let token;
    let cookie;

    if (req.body.email) {
      const data = await login(req.body.email, req.body.password);
      token = data.token;
      cookie = data.cookie;
    } else {
      let data = await googleLogin(req.body.google);
      token = data.token;
      cookie = data.cookie;
    }
    if (extention !== "mp3") {
      filePath = await convertFile(
        `./uploads/${req.file.originalname}`,
        `./uploads/${filename}.wav`
      );
    } else {
      filePath = `./uploads/${req.file.originalname}`;
    }
    const existFile = fs.existsSync(filePath);
    if (existFile) {
      const { data } = await googleSpeech(filePath);
      let formData = new FormData();
      formData.append("title", filename);
      formData.append("begin", data.begin);
      formData.append("end", data.end);
      formData.append(
        "file",
        fs.createReadStream(path.resolve(__dirname, filePath))
      );
      formData.append("recordItems", JSON.stringify(data.recordItems));
      formData.append("keywords", JSON.stringify([]));
      var config = {
        method: "post",
        url: "https://nooto.zen-s.com/api/v1/create-record",
        headers: {
          Accept: "application/json",
          "Content-Type": `multipart/form-data; boundary=${formData._boundary}`,
          Authorization: `Bearer ${token}`,
          Cookie: cookie,
        },
        data: formData,
      };

      const response = await axios(config);
      console.log(JSON.stringify(response.data));
      res.send(response.data);
    }
  } catch (e) {
    console.log(e);
    res.send({ error: JSON.stringify(e) });
  }
});

var server = app.listen(1994, function () {
  // var host = server.address().address;
  // var port = server.address().port;
});
