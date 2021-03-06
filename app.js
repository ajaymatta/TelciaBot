var express = require("express");
var request = require("request");
var bodyParser = require("body-parser");
var htmlToText = require('html-to-text');
var mongoose = require('mongoose');
var validation = require("validator");
var striptags = require('striptags');


//Connecting to DB
mongoose.connect(process.env.MONGODB_URI);

var Interaction = require("./models/interaction");


var app = express();
app.use(bodyParser.urlencoded({extended: false}));
app.use(bodyParser.json());
app.listen((process.env.PORT || 5000));

var updatedText = "";
var resToUiPath = null;
var nluData = "";
var userArray = [];
var sourceChannel = "FACEBOOK";


// Server index page
app.get("/", function (req, res) {
  res.send("Deployed!");
});


// Facebook Webhook
// Used for verification
app.get("/webhook", function (req, res) {
  if (req.query["hub.verify_token"] === process.env.VERIFICATION_TOKEN) {
    console.log("Verified webhook");
    res.status(200).send(req.query["hub.challenge"]);
  } else {
    console.error("Verification failed. The tokens do not match.");
    res.sendStatus(403);
  }
});


// To serve My Account, GMail and Alexa
app.get("/email", function (req, res) {  
  var msg = req.query.message;
  var senderId = req.query.senderId;
  sourceChannel = req.query.sourceChannel;

  console.log("Received message : \n"+msg+" \n From : "+senderId+" \n Via : "+sourceChannel);
  var formattedMsg  = striptags(msg.trim());    
  console.log("From : "+senderId + " Formatted Message : "+formattedMsg);

  updatedText = "";  
  resToUiPath=res;
  
  
  HubSpot_Integration(function() {    
    //sendMessage(senderId, {text: formattedMsg});
    respondAccordingToTone(findCurrentUser(senderId).vid.toString(),formattedMsg);
  });
});


// All callbacks for Messenger will be POST-ed here
app.post("/webhook", function (req, res) {
  console.log("Invoked webhook Post Method");
  // Make sure this is a page subscription
  if (req.body.object == "page") {
    // Iterate over each entry
    // There may be multiple entries if batched
    HubSpot_Integration( function() {
      console.log("executing callback");
      req.body.entry.forEach(function(entry) {
      // Iterate over each messaging event
        entry.messaging.forEach(function(event) {
          if (event.postback) {
            console.log("calling processPostback");
            sourceChannel="FACEBOOK";
            //HubSpot_Integration();
            processPostback(event);
          }
          else if (event.message) {
            sourceChannel="FACEBOOK";
            //HubSpot_Integration();
            processMessage(event);
          }
        });
      });
    res.sendStatus(200);
    });    
  }
});





function processPostback(event) {
  console.log("Inovked processPostback");
  var senderId = event.sender.id;
  var payload = event.postback.payload; 

  if (payload === "Greeting") {
    // Get user's first name from the User Profile API
    // and include it in the greeting
    greetingMsg(senderId);
  } 
}





function greetingMsg(senderId){
  console.log("came into greetingMsg");
   request({
      url: "https://graph.facebook.com/v2.6/" + senderId,
      qs: {
        access_token: process.env.PAGE_ACCESS_TOKEN,
        fields: "first_name"
      },
      method: "GET"
    }, function(error, response, body) {
      var greeting = "";
      if (error) {
        console.log("Error getting user's name: " +  error);
      } else {
        var bodyObj = JSON.parse(body);
        name = bodyObj.first_name;
        greeting = "Hi " + name + ". ";
      }
      var message = greeting + "I'm Telcia.\n How can I help you?";
      sendMessage(senderId, {text: message});
    });
}

// sends message to user
function sendMessage(recipientId, message) {
  console.log("Invoked sendMessage");
  //console.log("the message is" + message.text);
  message.text = updatedText +"\n" + message.text;
  console.log("the message is" + message.text);
  
  
  insertIntoDatebase(recipientId, message, nluData);

  if(sourceChannel != "FACEBOOK")
  {
    console.log("response sent? :"+resToUiPath.headersSent);
    if (resToUiPath.headersSent) return;
    resToUiPath.status(200).send(message.text);
  }
  else{
      recipientUser = findUserfromVid(recipientId);
      recipientId = recipientUser.fb_messenger_sender_id;
      request({
        url: "https://graph.facebook.com/v2.6/me/messages",
        qs: {access_token: process.env.PAGE_ACCESS_TOKEN},
        method: "POST",
        json: {
          recipient: {id: recipientId},
          message: message,
        }
      }, function(error, response, body) {
        if (error) {
          console.log("Error sending message: " + response.error);
        }
      });  
  }
}

function findCurrentUser (userId) {
  var currentUser={};
  if (userId.includes("@")) {
    for (var i = 0; i < userArray.length; i++) {
      if (userId.includes(userArray[i].email)) {
          currentUser = userArray[i];
          return currentUser;
      }
    }
  } else {
     if (!isNaN(userId)) {      
      for (var i = 0; i < userArray.length; i++) {
        if (userArray[i].fb_messenger_sender_id === userId) {
          currentUser = userArray[i];
          return currentUser;
        }
      }
    }
  }
  console.log("currentUser:" + JSON.stringify(currentUser)); 
  return null;
}

function findUserfromVid (userId) {
  console.log("came here and user id is :"+userId)
  if (!isNaN(parseInt(userId))) {      
    for (var i = 0; i < userArray.length; i++) {
      if (userArray[i].vid == userId) {        
          var currentUser = userArray[i];
          console.log("currentUser:" + JSON.stringify(currentUser));
          return currentUser;
      }
    }
  }
}  

function processMessage(event){
  console.log("Invoked processMessage");
  if (!event.message.is_echo) {
    var message = event.message;
    var senderId = event.sender.id;
    //console.log("Event is:" + event);
    console.log("Received message from senderId: " + senderId+" via "+sourceChannel);
    console.log("Message is: " + JSON.stringify(message));
    var responseMsg="";

    // You may get a text or attachment but not both
    if (message.text) {
      var formattedMsg = message.text.trim();
      updatedText = "";      
      respondAccordingToTone(findCurrentUser(senderId).vid.toString(),formattedMsg);      
    }
    else if (message.attachments){
      if (message.attachments[0].type==="audio"){
        var audioLink =   message.attachments[0].payload.url;
        console.log("Audio URL: " + audioLink);
        convertAudioToText(senderId,audioLink);
      }      
    }
  }
}

function HubSpot_Integration(callback) {
  console.log("HubSpot Integration");
  request({
        url: "https://api.hubapi.com/contacts/v1/lists/all/contacts/all?hapikey="+process.env.HAPIKey+"&property=firstname&property=lastname&property=email&property=fb_messenger_sender_id",
        method: "GET",
        }, function(hubspotError, hubspotResponse, hubspotBody) {
          console.log("Hubspot Response : "+hubspotBody);
          if (hubspotError) {
            console.log("Error Getting details from HubSpot: " + hubspotError);
            //sendMessage(senderId,{text:"Error Converting Speech to Text"});
          }
          else{
            var hubspotResult = JSON.parse(hubspotBody);
            console.log("HubSpot Data is:" + JSON.stringify(hubspotResult.contacts));
            userObjectCreation(hubspotResult.contacts);
            callback();            
          }            
      });
}

function userObjectCreation(contacts) {
  userArray = [];
  for(var i=0; i<contacts.length; i++){
    var user = {};
    user.vid = contacts[i].vid;
    if(contacts[i].properties && contacts[i].properties.firstname)  user.firstname=contacts[i].properties.firstname.value;
    if(contacts[i].properties && contacts[i].properties.lastname)  user.lastname=contacts[i].properties.lastname.value;
    if(contacts[i].properties && contacts[i].properties.email)  user.email=contacts[i].properties.email.value;
    if(contacts[i].properties && contacts[i].properties.fb_messenger_sender_id)  user.fb_messenger_sender_id = contacts[i].properties.fb_messenger_sender_id.value;
    userArray.push(user);    
  }
  console.log("userArray is:" + JSON.stringify(userArray));

}


function convertAudioToText(senderId, audioLink){
  console.log("Invoked convertAudioToText");
  request({
    url: "https://us-central1-sublime-calling-165813.cloudfunctions.net/convertAudioFormat",
    method: "POST",
    json: {
      "audioLink": audioLink      
    }
  }, function(error, response, body) {
    if (error) {
      console.log("Error Converting Audioclip Format: " + error);
      sendMessage(senderId,{text:"Error Converting Audioclip Format"});
    }
    else{      
      console.log("Converted Audioclip Format: " + body);
      var convertedAudioLink = body.opAudioLink;
      console.log("Converted Audioclip URL: " + convertedAudioLink);
      request({
        url: "https://us-central1-sublime-calling-165813.cloudfunctions.net/telciaSpeechToText",
        method: "POST",
        json: {
          "audioLink": convertedAudioLink      
        }
      }, function(spchErr, spchRes, spchBody) {
          if (error) {
            console.log("Error Converting Speech to Text: " + spchErr);
            sendMessage(senderId,{text:"Error Converting Speech to Text"});
          }
          else{
            console.log("Converted Audio to Text: " + spchBody);
            var extractedText = spchBody.text;
            console.log("Converted Audio to Text: " + extractedText);
            var formattedMsg = extractedText.trim();
            respondAccordingToTone(findCurrentUser(senderId).vid.toString(),formattedMsg);
          }

      });
    }
  });
}



function getNLUforCTA(senderId,message){
  console.log("Invoked getNLUforCTA for message :"+message);
  console.log("Sender id is:"+senderId);
  var sessionId = null;
  
  
  sessionId=senderId;
  
   request({
      url: "https://api.api.ai/v1/query?v=20150910&lang=en&sessionId="+sessionId+"&query="+message,
      headers: {
        Authorization: "Bearer "+process.env.API_AI_TOKEN
      },
      method: "GET"
    }, function(error, response, body) {
      console.log("NLU Response : \n" + JSON.stringify(response));

      if (error) {
        sendMessage(senderId,{text:"Error from API.ai"});
      } else {
        nluData = JSON.parse(body);        

        if(nluData.result!==null && response.statusCode===200){
          var nluAction = nluData.result.action;
          var contexts = nluData.result.contexts;
          console.log("nluAction value : " + nluAction);
          
          if(nluAction){
            switch(nluAction){
              case "triageBBIssues" :                
                updatedText = "";
                sendMessage(senderId,{text:nluData.result.fulfillment.speech});
                break;
              case "BBIssues.BBIssues-no":                
                getInfoFromDatabase(senderId, "triageBBIssues");                
                break;
              case "BBIssues.BBIssues-yes" :                
                updatedText = "";
                sendMessage(senderId,{text:nluData.result.fulfillment.speech});
                break;  
              case "triageWirelessIssues" :                
                updatedText = ""; 
                sendMessage(senderId,{text:nluData.result.fulfillment.speech});
                break;
              case "MobileDataIssues.MobileDataIssues-no":                
                getInfoFromDatabase(senderId, "triageWirelessIssues");                
                break;  
              case "MobileDataIssues.MobileDataIssues-yes" :                
                updatedText = "";
                sendMessage(senderId,{text:nluData.result.fulfillment.speech});
                break;   
              case "triageToTicket" :                
                updatedText = "";
                callToCreateTicket(senderId, contexts);
                break;
              case "CreateTicket" :                
                updatedText = "";
                createTicket(senderId, message);
                break;
              case "GetTicketStatus":
                updatedText = "";
                callToGetTicketStatus(senderId,  nluData.result.parameters.Ticket);                
                break;
              case "ChangeTicketStatus":
                updatedText = "";
                callToUpdateTicketStatus(senderId, nluData.result.parameters.TicketStatus, nluData.result.parameters.Ticket);                
                break;
              case "smalltalk.agent" :
              case "support.live_person" :            
              case "smalltalk.agent.annoying" :
              case "smalltalk.agent.bad" :
              case "smalltalk.agent.good" :                            
                updatedText = "";
                sendMessage(senderId, {text:nluData.result.fulfillment.speech});
                break;
              case "ExtractTicketNo":                              
                updatedText = "";
                getContext(senderId,contexts);
                break;
              case "ConfirmTicket":                
                updatedText = "";
                getContext(senderId,contexts);
                break;
              default:                
                updatedText = "";
                sendMessage(senderId, {text:nluData.result.fulfillment.speech});
                break;
            }
          }
          else{
            sendMessage(senderId, {text:"No Action returned from NLU"});   
          }
        }
        else
        {
          sendMessage(senderId, {text:"No Response returned from NLU"});
        }
      }
    });
}

function triageBBIssues(senderId, message){
  sendMessage(senderId,{text:"Follow the below steps and let me know if the Broadband issue still persists "});
}

function triageWirelessIssues(senderId, message){
  sendMessage(senderId,{text:"Follow the below steps and let me know if the Mobile issue still persists "});
}

function callToCreateTicket(senderId,contexts){

  var probDesc = "";
  for (var i=0; i<contexts.length;i++){ 
      if(contexts[i].name==='triage'){
        probDesc=contexts[i].parameters.any;      
      }
    }
    createTicket(senderId, probDesc); 
}

function getContext(senderId,contexts){
  var ticketId='';
  var toStatusFrmApp='';
  var getStatus=false;
  var updateStatus=false;
  var ticketConfirmation=false;

  for (var i=0; i<contexts.length;i++){        

    if(contexts[i].name==='confirmtoupdate'){
      ticketConfirmation=true;            
    }
    if(contexts[i].name==='getticketstatus'){
      getStatus=true;
      if(!ticketId) ticketId=contexts[i].parameters.Ticket;      
    }
    if(contexts[i].name==='updateticketstatus'){
      updateStatus=true;
      if(!ticketId)   ticketId=contexts[i].parameters.Ticket;
      toStatusFrmApp=contexts[i].parameters.TicketStatus;      
    }
  }

  if(updateStatus){
     var importantContext = "updateticketstatus";
     if (ticketConfirmation) importantContext = "confirmToUpdate";
     callToUpdateTicketStatus(senderId, toStatusFrmApp, ticketId,importantContext);  
  }
  else{
      getTicketStatus(senderId, ticketId);  
  }
}

function callToUpdateTicketStatus(senderId, toStatusFrmApp, ticketId,importantContext){
  
  var toStatusToApi="";
  if(toStatusFrmApp){
    toStatusFrmApp = toStatusFrmApp.toLowerCase().trim();
      switch(toStatusFrmApp){
        case "close": 
          toStatusToApi="closed"; 
          break;
        case "cancel":
          toStatusToApi="cancelled"; 
          break;
        case "reopen":
          toStatusToApi="created"; 
          break;
      }
  }

  if(ticketId && toStatusFrmApp){      
      updateTicketStatus(senderId, toStatusToApi, ticketId);
  } 
  else{    
    if(toStatusFrmApp){
      if(toStatusFrmApp === 'reopen'){
        if(importantContext==='confirmToUpdate'){          
          getMyClosedCancelledTickets(senderId,'updateConfirmed',toStatusToApi); 
        }
        else
        {
          getMyClosedCancelledTickets(senderId,'update',toStatusToApi);         
        }
      }
      else if (toStatusFrmApp === 'cancel' || toStatusFrmApp === 'close'){
        if(importantContext==='confirmToUpdate'){
          getMyOpenTickets(senderId,'updateConfirmed',toStatusToApi);
        }
        else
        {
          getMyOpenTickets(senderId,'update',toStatusToApi);
        }          
      }
      else{
        if(importantContext==='confirmToUpdate'){
          getMyTickets(senderId,'updateConfirmed',toStatusToApi);  
        }
        else
        {
          getMyTickets(senderId,'update',toStatusToApi);    
        }        
      }      
    }
    else{
      sendMessage(senderId, {text:"What update do you want on the ticket "});
    }
  }
}

function updateTicketStatus(senderId, toStatus, ticketId){  
  request({
    url: "https://lychee-cake-64261.herokuapp.com/API/troubleTicket/"+ticketId,
    method: "PATCH",
    json: {"status": toStatus}
  }, function(error, response, body) {
    if (error) {
      console.log("Error updating ticket: " + error);
      sendMessage(senderId,{text:"Error updating ticket"});
    }
    else{
      if(response.statusCode===201){
        var ticketJson = body;
        var ttId = ticketJson.id;
        var ticketStatus = ticketJson.status;
        var ticketSubStatus = ticketJson.subStatus; 
        var responseMSg = "Ticket "+ ttId+" "+ticketStatus;
        if(ticketStatus === "created"){
          responseMSg = "Ticket "+ ttId+" reopened";
        }
        if(ticketSubStatus){
          responseMSg = "Status of Ticket "+ ttId+" updated to "+ticketStatus+" "+ticketSubStatus;
        }
        sendMessage(senderId,{text:responseMSg}); 
      
      }
      else{
        var responseMSg = htmlToText.fromString(response.body, {
          wordwrap: 130
        });
        sendMessage(senderId,{text:responseMSg});  
      }
    }
  });
}

function callToGetTicketStatus(senderId,ticketId){

  if(ticketId){
      getTicketStatus(senderId, ticketId);
  } 
  else{
      getMyTickets(senderId,'get',null);
  }
}


function getMyClosedCancelledTickets(senderId, intendingTo,toStatusToApi){
   request({
    url: "https://lychee-cake-64261.herokuapp.com/API/troubleTicket/myClosedTT/"+senderId,
    method: "GET"
    }, function(error, response, body) {
    if(error){
      console.log("Error Getting Status: " + error);
      sendMessage(senderId,{text:"Error Getting Status for Ticket#"+ticketId});
    }
    else{
      if(response.statusCode===200){
        var ticketsJson = JSON.parse(body);
        processUpdateRequest(senderId, intendingTo,toStatusToApi,ticketsJson);        
      }
      else if (response.statusCode===404){
        var responseMSg = htmlToText.fromString(response.body, {
          wordwrap: 130
        });
        sendMessage(senderId,{text:responseMSg}); 
      }
      else{
        sendMessage(senderId,{text:response.statusMessage});   
      }
    }
  });
}

function getMyOpenTickets(senderId, intendingTo,toStatusToApi){
   request({
    url: "https://lychee-cake-64261.herokuapp.com/API/troubleTicket/myOpenTT/"+senderId,
    method: "GET"
    }, function(error, response, body) {
    if(error){
      console.log("Error Getting Status: " + error);
      sendMessage(senderId,{text:"Error Getting Status for Ticket#"+ticketId});
    }
    else{
      if(response.statusCode===200){
        var ticketsJson = JSON.parse(body);
        processUpdateRequest(senderId, intendingTo,toStatusToApi,ticketsJson);      
      }
      else if (response.statusCode===404){
        var responseMSg = htmlToText.fromString(response.body, {
          wordwrap: 130
        });
        sendMessage(senderId,{text:responseMSg}); 
      }
      else{
        sendMessage(senderId,{text:response.statusMessage});   
      }
    }
  });
}

function getMyTickets(senderId, intendingTo,toStatusToApi){
  
   request({
    url: "https://lychee-cake-64261.herokuapp.com/API/troubleTicket/myTT/"+senderId,
    method: "GET"
    }, function(error, response, body) {      
    if(error){
      console.log("Error Getting Status: " + error);
      sendMessage(senderId,{text:"Error Getting your Ticket details"});
    }
    else{
      
      if(response.statusCode===200){        
        var ticketsJson = JSON.parse(body);
        processUpdateRequest(senderId, intendingTo,toStatusToApi,ticketsJson);
      }
      else if (response.statusCode===404){
        var responseMSg = htmlToText.fromString(response.body, {
          wordwrap: 130
        });
        sendMessage(senderId,{text:responseMSg}); 
      }
      else{
        sendMessage(senderId,{text:response.statusMessage});   
      }
    }
  });
}

function processUpdateRequest(senderId, intendingTo,toStatusToApi,ticketsJson){
  var noOfTickets = ticketsJson.length;
  if(noOfTickets===0){
    sendMessage(senderId,{text:"You do not have any ticket in our systems."}); 
    sendMessage(senderId,{text:"Are you facing any problem for which you want ticket created?"}); 
    sendMessage(senderId,{text:"Tell me about your problem."}); 
  }
  else if (noOfTickets===1){
    
    if(intendingTo==='get'){             
      composeTicketStatus(senderId,ticketsJson[0]);
    }
    else if(intendingTo==='update'){            
      
      var statusToPrint=toStatusToApi;
      if(statusToPrint==='created'){
        statusToPrint='reopened';
      }
      sendMessage(senderId,{text:" Are you sure you want the Ticket# "+ticketsJson[0].id+"  "+statusToPrint});
    } 
    else if (intendingTo==='updateConfirmed'){
      updateTicketStatus(senderId, toStatusToApi, ticketsJson[0].id);
    }         
  }
  else if(noOfTickets>1){
    sendMessage(senderId,{text:"You have more than one ticket in our system."});
    sendMessage(senderId,{text:"Following are the details of last few of your tickets."});

    var limit = 3;
    if(noOfTickets<3){
      limit = noOfTickets;
    }
    for(var i=0;i<limit;i++){
      composeTicketStatus(senderId,ticketsJson[i]);
    } 
  }
}

function composeTicketStatus(senderId, ticket){
  var status=ticket.status;
  if(status==='created'){
    status='New, Yet to be picked up by an agent';
  }

  var responseMsg = "Ticket ID# : " +ticket.id;
  responseMsg = responseMsg+"\nProblem Desc : "+ ticket.description;
  responseMsg = responseMsg+"\nCurrent Status : "+ status;
  if(ticket.subStatus)  responseMsg = responseMsg+" with "+ ticket.subStatus;
  if(ticket.note.length>0){
    responseMsg = responseMsg+"\nLast Note : ";  
    var ticketNotes = ticket.note;
    if(ticketNotes.length>1){
      ticketNotes.sort(custom_sort);
      responseMsg = responseMsg+ticketNotes[0].text+" added on "+ ticketNotes[0].date;  
    }
    else{
      responseMsg = responseMsg+ticketNotes[0].text+" added on "+ ticketNotes[0].date;  
    }
    

  }
  
  sendMessage(senderId,{text:responseMsg}); 
}


function custom_sort(a, b) {
    return  new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime() ;
}

function getTicketStatus(senderId, ticketId){
   request({
    url: "https://lychee-cake-64261.herokuapp.com/API/troubleTicket/"+ticketId,
    method: "GET"
  }, function(error, response, body) {
    if(error){
      console.log("Error Getting Status: " + error);
      sendMessage(senderId,{text:"Error Getting Status for Ticket#"+ticketId});
    }
    else{
      if(response.statusCode===200){
        var ticketJson = JSON.parse(body);
        composeTicketStatus(senderId,ticketJson);   
      }
      else if (response.statusCode===404){
        var responseMSg = htmlToText.fromString(response.body, {
          wordwrap: 130
        });
        sendMessage(senderId,{text:responseMSg}); 
      }
      else{
        sendMessage(senderId,{text:response.statusMessage});   
      }
    }
  });
}

function createTicket(senderId,receivedText){
  console.log('Creating Ticket for Problem : '+receivedText);
   request({
    url: "https://lychee-cake-64261.herokuapp.com/API/troubleTicket",
    method: "POST",
    json: {
      "description": receivedText,
      "severity":"3",
      "type":"service issue",
      "relatedParty":[{
        "href":senderId,
        "role":"Originator"
      }]
    }
  }, function(error, response, body) {
    console.log('Response from Ticket API :'+JSON.stringify(response));
    if (error) {
      console.log("Error creating ticket: " + error);
      sendMessage(senderId,{text:"Error creating ticket"});
    }
    else{
      var ticketId = body.id;
      sendMessage(senderId,{text:"Created Ticket# "+ticketId+". Refer to this ticket for future communication on this issue."});
    }
  });
}


function respondAccordingToTone(senderId,receivedText){
  
  console.log ("Invoked respondAccordingToTone");  
  var ToneAnalyzerV3 = require('watson-developer-cloud/tone-analyzer/v3');
 
  var tone_analyzer = new ToneAnalyzerV3({
    username: process.env.WATSON_USERNAME,
    password: process.env.WATSON_PASSWORD,
    version_date: process.env.WATSON_VERSION
  });

  
  tone_analyzer.tone({ text: receivedText },
    function(err, tone) {
      if (err)
      {
        console.log ("Error Response from Watson :"+err);
        sendMessage(senderId, {text: "Error Accessing Watson :"+err});
      }
      else{        
        console.log ("Watson ToneAnalyzer Response :"+JSON.stringify(tone));
        var emoTones = tone.document_tone.tone_categories[0].tones;        
        var maxValue = 0;
        for (var i=0; i<emoTones.length;i++){
          if(emoTones[i].score>0.5){
            if (!maxValue || parseInt(emoTones[i].score) > parseInt(maxValue.score))
                maxValue = emoTones[i];               
          }
        }
    
      
        if (maxValue) {
          console.log("Sentiment :"+maxValue.tone_id);
          switch(maxValue.tone_id){
            case "sadness":
            updatedText = "I'm sorry about how you are feeling about our service.\n"
            break;
            case "fear":
            updatedText =  "We are here to help you out to fix your issues. You can have less worry about your issue\n"
            case "anger":
            case "disgust":
            updatedText =  "I'm sorry. Our support team will get in touch with you now.\n We would also like to provide $5 credit to your account which will be adjusted in next bill.";            
            break;
            case "joy":
            updatedText = "Glad you are happy with my service.";            
            break;
          }
        } else {
          updatedText = "";
        }
      
      
        console.log ("Updated Text value is:" + updatedText);
        if (maxValue.tone_id != "anger") {
          getNLUforCTA(senderId,receivedText.trim());
        } else {
          sendMessage(senderId, {text:""});
        }
      }
  });
}


function insertIntoDatebase (senderId, message, nluData) {
  if (nluData) {
    if (!nluData.result || !nluData.result.resolvedQuery) {
      nluData.result.resolvedQuery = "";
    }
    if (!nluData.result || !nluData.result.action) {
      nluData.result.action = "";
    }    
    if (!nluData.result.fulfillment || !nluData.result.fulfillment.speech) {
      nluData.result.fulfillment.speech = "";
    }


    var contextArray = [];
    for (var i = 0;i < nluData.result.contexts.length; i++) {
      var tempcontext = {};
      tempcontext.name="";
      tempcontext.lifespan=0;
      console.log("name:"+ nluData.result.contexts[i].name);
      console.log("lifespan:"+ nluData.result.contexts[i].lifespan);
      tempcontext.name = nluData.result.contexts[i].name;
      tempcontext.lifespan = nluData.result.contexts[i].lifespan;
      console.log("tempcontext:"+ tempcontext.name + tempcontext.lifespan);
      contextArray.push(tempcontext);
    }
    
    var interactionInsert = new Interaction({
      id: "1",
      user: senderId,
      creationDate: new Date(),
      resolvedQuery: nluData.result.resolvedQuery,
      action: nluData.result.action,
      contexts: contextArray,
      response: nluData.result.fulfillment.speech
    });
    interactionInsert.save(function(err) {  
      if (err) throw err;
      console.log('User created!');
    });
  }
}

function getInfoFromDatabase(senderId, triggerAction) {
  //var InteractionData = mongoose.model("Interaction", InteractionSchema);
  Interaction.findOne({ action: triggerAction }).sort('-creationDate').exec(function (err, member) {
    if (err) {
      return err;
    }
    console.log("member value is" + member);
    //return member.resolvedQuery;
    createTicket(senderId, member.resolvedQuery);
  });
}
