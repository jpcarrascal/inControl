const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const { AllRooms } = require("./scripts/roomsObj.js");
const config = require('./scripts/config.js');


const { createLogger, format, transports } = require('winston');
const { combine, timestamp, label, printf } = format;

const myFormat = printf(({ level, message, label, timestamp }) => {
  return `${timestamp} ${message}`;
});

const logger = createLogger({
  format: combine(
    label({ label: 'countmein' }),
    timestamp(),
    myFormat
  ),
  transports: [
      new transports.Console(),
      new transports.File({ filename: 'info.log' })
    ]
});

var rooms = new AllRooms(config.NUM_TRACKS, config.MAX_NUM_ROUNDS);

app.get('/', (req, res) => {
    // req.query.seq
    var page = '/html/index.html';
    res.sendFile(__dirname + page);
});

app.get('/sequencer', (req, res) => {
    if(req.query.room)
        var page = '/html/sequencer.html';
    else
        var page = '/html/index.html';
    res.sendFile(__dirname + page);
});

app.get('/track', (req, res) => {
    if(req.query.room && (req.query.initials || req.query.initials==="") )
        var page = '/html/track.html';
    else
        var page = '/html/index-track.html';
    res.sendFile(__dirname + page);
});

app.get('/favicon.ico', (req, res) => {
    // req.query.seq
    var page = '/images/favicon.ico';
    res.sendFile(__dirname + page);
});

app.use('/scripts', express.static(__dirname + '/scripts/'));
app.use('/css', express.static(__dirname + '/css/'));
app.use('/images', express.static(__dirname + '/images/'));
app.use('/sounds', express.static(__dirname + '/sounds/'));

io.on('connection', (socket) => {
    var seq = false;
    if(socket.handshake.headers.referer.includes("sequencer"))
        seq = true;
    var room = socket.handshake.query.room;
    var initials = socket.handshake.query.initials;
    var allocationMethod = socket.handshake.query.method || "random";
    socket.join(room);
    if(seq) {
        const exists = rooms.findRoom(room);
        if(exists >= 0) io.to(socket.id).emit('sequencer exists', {reason: "'"+room+"' exists already. Choose a different name."});
        else {
            rooms.addRoom(room, allocationMethod);
            logger.info(" ["+room+"] "+"Sequencer joined room");
            rooms.setSeqID(room,socket.id);
            socket.on('disconnect', () => {
                logger.info(" ["+room+"] ["+initials + "] disconnected (sequencer). Clearing room");
                socket.broadcast.to(room).emit('exit session',{reason: "Sequencer exited!"});
                rooms.clearRoom(room);
            });
        }
    } else {
        if(rooms.isReady(room)) {
            var track = rooms.allocateAvailableParticipant(room, socket.id, initials);
            logger.info(" ["+room+"] ["+initials + "] joined room on track " + track);
            socket.broadcast.to(room).emit('track joined', { initials: initials, track:track, socketid: socket.id });
            socket.on('disconnect', () => {
                var track2delete = rooms.getParticipantNumber(room, socket.id);
                rooms.releaseParticipant(room, socket.id);
                io.to(room).emit('clear track', {track: track2delete, initials: initials});
                logger.info(" ["+room+"] ["+initials + "] (" + socket.id + ") disconnected, clearing track " + track2delete);
            });
            io.to(socket.id).emit('create track', {track: track, maxNumRounds: config.MAX_NUM_ROUNDS});
        } else {
            io.to(socket.id).emit('exit session', {reason: "Session has not started..."});
        }
    }
    socket.on('step update', (msg) => { // Send step values
        io.to(room).emit('step update', msg);
        rooms.participantStartCounting(room, socket.id);
        let initials = rooms.getParticipantInitials(room, socket.id);
        logger.info(" ["+room+"] ["+ initials +"] step updated: track: "+msg.track+" step: "+msg.step+" note: "+msg.note+" value: "+msg.value);
    });

    socket.on('track notes', (msg) => { // Send all notes from track
        io.to(msg.socketid).emit('update track', msg);
    });

    socket.on('step tick', (msg) => { // Visual sync
        socket.broadcast.to(room).emit('step tick', msg);
        var expired = new Array();
        if(msg.counter == config.NUM_STEPS-1) {
            expired = rooms.incrementAllCounters(room);
        }
        if(expired.length > 0) {
            for(var i=0; i<expired.length; i++) {
                logger.info(" ["+room+"] ["+expired[i].initials + "] session expired!");
                io.to(expired[i].socketID).emit('exit session', {reason: "Join again?"});
            }
        }
    });

    socket.on('play', (msg) => {
        socket.broadcast.to(room).emit('play', msg);
        logger.info(" ["+room+"] "+"Playing...");
    });

    socket.on('stop', (msg) => {
        socket.broadcast.to(room).emit('stop', msg);
        logger.info(" ["+room+"] "+"Stopped.");
    });

});

var port = process.env.PORT || 3000;
server.listen(port, () => {
  logger.info('listening on *:' + port);
});


function exitHandler(options, exitCode) {
    logger.info("Bye!!!")
    if (options.cleanup) logger.info('clean');
    if (exitCode || exitCode === 0) logger.info(exitCode);
    if (options.exit) process.exit();
}

process.on('SIGINT', exitHandler.bind(null, {exit:true}));