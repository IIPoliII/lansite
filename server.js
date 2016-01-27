//
//  Lansite Server
//  By Tanner Krewson
//

//
//  INITIAL SETUP
//

//requires
var crypto = require('crypto');
var readline = require('readline');
var express = require('express');
var socketio = require('socket.io');
var app = express();

var passport = require('passport');
var SteamStrategy = require('passport-steam').Strategy;

var Box = require('./boxes/shared/Box');
var Dispatcher = require('./boxes/shared/Dispatcher');


//read the config file
var Config;
try {
    Config = JSON.parse(require('fs').readFileSync('./config.json', 'utf8'));
} catch (e) {
    console.log('Failed to parse config.json');
    console.log('Make sure you removed all comments and renamed it to config.json');
    process.exit(1);
}

try {
    //checks to see if the user has changed their Steam API key
    if (Config.steamAPIKey.length !== 32 || Config.steamAPIKey !== Config.steamAPIKey.replace(/\W/g, '')) {
        throw err;
    }
} catch (e) {
    console.log('Invalid Steam API key');
    console.log('Please add your Steam API key to config.json');
    process.exit(1);
}


//loads boxes from the /boxes directory and preps for making console commands
var BoxObjects = {};
var BoxNames = [];

require("fs").readdirSync(require("path").join(__dirname, "boxes")).forEach(function(file) {
    var fileNameMinusTheDotJS = file.substr(0, file.length - 3);

    //prevent it from loading the template and makes sure the id and filename match (not strictly necessary...)
    if (!fileNameMinusTheDotJS.startsWith('_') && file !== 'shared') {
        var tempObject = require("./boxes/" + file);
        if (tempObject.id === fileNameMinusTheDotJS) {
            var boxName = fileNameMinusTheDotJS.toLowerCase();
            //place each script into the object literal
            BoxObjects[boxName] = require("./boxes/" + file);
            //place each object name in to BoxNames
            BoxNames.push(boxName);
        }
    }
});


//handlebars setup
var hbs = require('express-handlebars').create({
    defaultLayout: 'main'
});
app.engine('handlebars', hbs.engine);
app.set('view engine', 'handlebars');


//express stuff
app.use(express.static(__dirname + '/public'));

//passport setup
app.use(passport.initialize());
app.use(passport.session());
passport.serializeUser(function(user, done) {
    done(null, user);
});

passport.deserializeUser(function(obj, done) {
    done(null, obj);
});

//url mapping
app.get('/', exposeTemplates, function(req, res) {
    res.render('home');
});


//start server
var io = socketio.listen(app.listen(Config.port, function() {
    console.log('Lansite is now runnning. Type "stop" to close.');
}));


// sends the box and popup templates to the page
// TODO: Figure out how to precompile these template, or whatever
function exposeTemplates(req, res, next) {
    hbs.getTemplates('templates/').then(function(templates) {

        // Creates an array of templates which are exposed via
        // `res.locals.templates`.
        var boxes = Object.keys(templates).map(function(name) {
            //if the file doesn't start with and is a box template
            if (!(name.indexOf('/_') > -1) && name.startsWith('boxes/')) {
                return {
                    template: templates[name]()
                };
            } else {
                return null;
            }
        });

        var popups = Object.keys(templates).map(function(name) {
            //if the file doesn't start with and is a popup template
            if (!(name.indexOf('/_') > -1) && name.startsWith('popups/')) {
                return {
                    template: templates[name]()
                };
            } else {
                return null;
            }
        });

        // Exposes the templates during view rendering.
        if (boxes.length) {
            res.locals.boxes = boxes;
        }

        if (popups.length) {
            res.locals.popups = popups;
        }

        setImmediate(next);
    }).catch(next);
}

//
//  OBJECTS
//

function Stream() {
    this.boxes = [];
    this.users = new Users();
    this.requestManager = new RequestManager();
}

Stream.prototype.addBoxAndSend = function(boxToAdd) {
    var boxUnique = this.addBox(boxToAdd);
    this.sendBox(boxUnique);
};

Stream.prototype.addBoxById = function(boxId, data) {
    var box = this.addBox(new BoxObjects[boxId.toLowerCase()](data));
    return box.unique;
};

Stream.prototype.addBox = function(boxToAdd) {
    //adds the box to the server-side stream
    this.boxes.push(boxToAdd);
    return boxToAdd.unique;
};

Stream.prototype.sendBox = function(uniqueOfBoxToSend) {
    var index = this.getBoxIndexByUnique(uniqueOfBoxToSend);

    //if the boxes exists in this stream
    if (index !== -1){
        var boxToSend = this.boxes[index];
        //add the socket listeners to each user's socket
        Dispatcher.attachListenersToAllUsers(boxToSend, this.users);

        //sends the box to everyone
        Dispatcher.sendNewBoxToAll(boxToSend, this.users);
    } else {
        console.log('Send box failed: Box does not exist in this stream');
    }
};

Stream.prototype.showAll = function() {
    //clear all from screen
    this.clearAll();

    //this is so that the elements are shown in decsending chonological order
    //slice makes the array copy by val instead of ref
    var tempArray = this.boxes.slice().reverse();
    tempArray.forEach(function(element) {
        element.show();
    });

};

Stream.prototype.clearAll = function() {
    $('#stream').empty();
};

Stream.prototype.listAllBoxes = function() {
    var result = '';
    this.boxes.forEach(function(box) {
        result += box.unique + "\n";
    });
    return result;
};

Stream.prototype.getBoxIndexByUnique = function(boxUnique) {
    for (var i = this.boxes.length - 1; i >= 0; i--) {
        if (this.boxes[i].unique === boxUnique) {
            return i;
        }
    };
    return -1;
}

Stream.prototype.initializeSteamLogin = function() {

    var self = this;
    var LoginSuccessHandler = function(req, res, stream) {
        //this is ran when the user successfully logs into steam

        //generate the user's unique identifier that will be use
        //    to identify them once they are redirected to the
        //    main stream.
        var tempUnique = crypto.randomBytes(20).toString('hex');

        //add the user to the stream and await their return
        stream.users.addUserOrUpdateUnique(tempUnique, req.user.id, req.user.displayName, req.user._json.realname);

        //set a cookie that will act as the user's login token
        res.cookie('unique', tempUnique, {
            maxAge: 604800000 // Expires in one week
        });

        //redirect home
        res.redirect('/');
    };

    passport.use(new SteamStrategy({
            returnURL: 'http://localhost:' + Config.port + '/auth/steam/return',
            realm: 'http://localhost:' + Config.port + '/',
            apiKey: Config.steamAPIKey
        },
        function(identifier, profile, done) {
            //i don't know what any of this does
            profile.identifier = identifier;
            return done(null, profile);
        }
    ));

    app.get('/auth/steam',
        passport.authenticate('steam'),
        function(req, res) {});

    app.get('/auth/steam/return',
        passport.authenticate('steam', {
            failureRedirect: '/'
        }),
        function(req, res) {
            LoginSuccessHandler(req, res, self);
        });


    //fake steam login for development purposes
    //if developer mode is enabled
    if (Config.developerMode) {
        app.get('/devlogin', function(req, res) {
            // http://localhost:port/devlogin?id=IDHERE&displayName=DNAMEHERE&realname=RNAMEHERE
            req.user = {
                id: req.query.id,
                displayName: req.query.displayName,
                _json: {
                    realname: req.query.realname
                }
            };
            LoginSuccessHandler(req, res, self);
        });
    }

    //pretty sure this is useless
    app.get('/logout', function(req, res) {
        req.logout();
        res.redirect('/');
    });

};



function Users() {
    this.list = [];
}

Users.prototype.addUserOrUpdateUnique = function(unique, id, displayName, realName) {
    for (element of this.list) {
        //if this user already exists
        if (element.id === id) {
            //update their info (i don't update realName)
            element.unique = unique;
            element.displayName = displayName;

            //should already be null, just precautionary
            element.socket = null;
            return element;
        }
    }

    //ran if the user does not already exist
    var tempUser = new User(unique, id, displayName, realName);
    this.list.push(tempUser);
    return tempUser;
}

Users.prototype.admitUserIfExists = function(unique, socket) {
    if (this.checkIfUserExists(unique)) {
        //user found! update their info
        element.socket = socket;
        return element;
    }

    //user not found
    return null;
}

Users.prototype.checkIfUserExists = function(unique) {
    for (element of this.list) {
        if (element.unique === unique) {
            return element;
        }
    }
    return false;
}

Users.prototype.removeUser = function(userToRemove) {
    var indexToRemove = this.list.indexOf(userToRemove);
    if (indexToRemove > -1) {
        this.list.splice(indexToRemove, 1);
    }
}

Users.prototype.getAllUsers = function() {
    /*var result = '';
    this.list.forEach(function(element) {
        result += element.unique + "\n";
    });
    return result;*/
    return this.list;
}

Users.prototype.getOnlineUsers = function() {
    var result = [];
    this.list.forEach(function(user) {
        if (user.isOnline()) {
            result.push(user);
        }
    });
    return result;
}

Users.prototype.getOppedUsers = function() {
    var result = [];
    this.list.forEach(function(user) {
        if (user.isOnline()) {
            result.push(user);
        }
    });
    return result;
}



function User(unique, id, displayName, realName) {
    this.unique = unique;
    this.socket = null;

    this.id = id;
    this.displayName = displayName;
    this.realName = realName;
    this.isOp = false;
}

User.prototype.isOnline = function() {
    return this.socket !== null;
}

User.prototype.op = function() {
    this.isOp = true;
}

User.prototype.deop = function() {
    this.isOp = false;
}



function Console() {}

Console.addListeners = function(stream) {
    var stdin = process.openStdin();
    stdin.addListener("data", function(d) {
        //string of what was entered into the console
        var line = d.toString().trim();

        //automatic add commands
        if (line.startsWith('add ')) {
            var lineArr = line.split(' ');
            if (lineArr[1].toLowerCase() in BoxObjects) {
                var lengthBeforeData = lineArr[0].length + lineArr[1].length + 2;
                var data = {
                    isConsole: true,
                    line: line.substr(lengthBeforeData, line.length)
                }
                stream.addBoxAndSend(new BoxObjects[lineArr[1].toLowerCase()](data));
            }
        }

        if (line === "requests"){
            var reqman = stream.requestManager;
            var reqlist = reqman.getRequests();
            //TODO: Remove testing code
            console.log(reqlist);
            reqman.handleRequest(reqlist[0], true);
        }

        //static commands
        if (line === "stop")
            process.exit();
        if (line === "users")
            console.log(stream.users.getAllUsers());
        if (line === "listAllBoxes")
            console.log(stream.listAllBoxes());
    });
}



function RequestManager() {
    this.requestList = [];
}

RequestManager.prototype.addRequest = function(functionToRun, userThatMadeRequest){
    this.requestList.push(new Request(functionToRun, userThatMadeRequest));
}

RequestManager.prototype.getRequests = function(){
    return this.requestList;
}

RequestManager.prototype.handleRequest = function(request, accepted, denied){
    if (accepted){
        request.acceptRequest();
    } else {
        //TODO: add denied request function
    }
    this.removeRequest(request);
}

RequestManager.prototype.removeRequest = function(request){
    var requestIndex = this.requestList.indexOf(request);

    //if request exists
    if (requestIndex !== -1) {
        //remove the request from the array
        this.requestList.splice(requestIndex, 1);
        return true;
    } else {
        return false;
    };
}



function Request(userThatMadeRequest, acceptFunction, denyFunction) {
    this.unique = crypto.randomBytes(20).toString('hex');
    this.user = userThatMadeRequest;
    this.acceptFunction = acceptFunction;
    this.denyFunction = denyFunction;
}

Request.prototype.acceptRequest = function(){
    this.acceptFunction(this.user);
}

Request.prototype.denyRequest = function(){
    this.denyFunction(this.user);
}



//
//  MAIN CODE
//


//this stream will be shown to users not logged in
var initialStream = new Stream();
initialStream.addBox(new BoxObjects['initialbox']());

var mainStream = new Stream();
Console.addListeners(mainStream);
mainStream.initializeSteamLogin();

//handles users coming and going
io.on('connection', function(socket) {
    //console.log('Unauthenticated user connected');

    Dispatcher.sendStreamToSocket(initialStream.boxes, socket);

    //sent by client if it detects it has a valid token in it's cookies
    socket.on('login', function(msg) {
        var user = mainStream.users.admitUserIfExists(msg.unique, socket);

        //user will be null if it failed to find the user
        if (user !== null) {
            console.log('User successfully validated');

            //check to see if we should set the user to OP
            if (Config.autoOPFirstUser && mainStream.users.list.length === 1) {
                user.op();

                //var user above seems to be a copy, so we need to do this
                //    for the above code to take effect
                //mainStream.users.list[0] = user;
            }

            //send the boxes of the actual stream
            Dispatcher.sendStream(mainStream.boxes, user);

            //add the socket listeners to the user for all of the current boxes
            mainStream.boxes.forEach(function(box) {
                box.addResponseListeners(socket, mainStream.users);
            });

            //add static request listeners for each type of box
            BoxNames.forEach(function(boxName){
                var box = BoxObjects[boxName];
                if (box.addRequestListeners !== undefined){
                    box.addRequestListeners(socket, mainStream);
                }
            });

            //send the updated user list to all users
            Dispatcher.sendUserListToAll(mainStream.users);

            socket.on('disconnect', function() {
                console.log(user.displayName + ' disconnected');
                user.socket = null;
                //mainStream.users.removeUser(user);

                //send the updated user list to all users
                Dispatcher.sendUserListToAll(mainStream.users);
            });

        } else {
            console.log('User validation unsuccessful');
        }
    });

    socket.on('disconnect', function() {
        //console.log('Unauthenticated user disconnected');
        //mainStream.users.removeUser(user);
    });
});