var express = require("express");
var request = require("request");
var bodyParser = require("body-parser");
var htmlToText = require('html-to-text');


var app = express();
app.use(bodyParser.urlencoded({extended: false}));
app.use(bodyParser.json());
app.listen((process.env.PORT || 5000));

var updatedText = "";

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

// All callbacks for Messenger will be POST-ed here
app.post("/webhook", function (req, res) {
	console.log("came to first post webhook");
  // Make sure this is a page subscription
  if (req.body.object == "page") {
    // Iterate over each entry
    // There may be multiple entries if batched
    req.body.entry.forEach(function(entry) {
      // Iterate over each messaging event
      entry.messaging.forEach(function(event) {
        if (event.postback) {
			console.log("calling processPostback");
          processPostback(event);
        }
        else if (event.message) {
          processMessage(event);
        }
      });
    });

    res.sendStatus(200);
  }
});





function processPostback(event) {
	console.log("came into processPostback");
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
	console.log("came into sendMessage");
	//console.log("the message is" + message.text);
	message.text = updatedText +"\n" + message.text;
	console.log("the message is" + message.text);
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


function processMessage(event){
	console.log("came into processMessage");
  if (!event.message.is_echo) {
      var message = event.message;
      var senderId = event.sender.id;
      console.log("Received message from senderId: " + senderId);
      console.log("Message is: " + JSON.stringify(message));
      var responseMsg="";

      // You may get a text or attachment but not both
      if (message.text) {
        var formattedMsg = message.text.trim();
		updatedText = "";
		//sendMessage(senderId, {text: formattedMsg});
		respondAccordingToTone(senderId,message.text);
        //getNLUforCTA(senderId,formattedMsg);
      }
  }
}

function getNLUforCTA(senderId,message){
	console.log("came into getNLUforCTA");
   request({
      url: "https://api.api.ai/v1/query?v=20150910&lang=en&sessionId="+senderId+"&query="+message,
      headers: {
        Authorization: "Bearer "+process.env.API_AI_TOKEN
      },
      method: "GET"
    }, function(error, response, body) {
      if (error) {
        sendMessage(senderId,{text:"Error from API.ai"});
      } else {
        var nluData = JSON.parse(body);

        var nluAction = nluData.result.action;
        var contexts = nluData.result.contexts;
		console.log("nluAction value is" + nluAction);
        
        if(nluAction){
          switch(nluAction){
          	case "triageBBIssues" :
              //sendMessage(senderId,{text:"Suggest Creating Ticket"});
              sendMessage(senderId, {text:nluData.result.fulfillment.speech});
              break;
            case "triageWirelessIssues" :
              //sendMessage(senderId,{text:"Suggest Creating Ticket"});  
              sendMessage(senderId, {text:nluData.result.fulfillment.speech});
              break;
            case "triageToTicket" :
              //sendMessage(senderId,{text:"Suggest Creating Ticket"});
              updatedText = "";
              callToCreateTicket(senderId, contexts);
              break;
            case "CreateTicket" :
              //sendMessage(senderId,{text:"Suggest Creating Ticket"});
              updatedText = "";
              createTicket(senderId, message);
              break;
            case "GetTicketStatus":
            updatedText = "";
              callToGetTicketStatus(senderId,  nluData.result.parameters.Ticket);
              //sendMessage(senderId,{text:"Getting Ticket Status"});
              //sendMessage(senderId,{text:"Getting Ticket Status"});
              break;
            case "ChangeTicketStatus":
              callToUpdateTicketStatus(senderId,  nluData.result.parameters.TicketStatus, nluData.result.parameters.Ticket);
              //sendMessage(senderId,{text:"Changing Ticket Status"});
              break;
            case "smalltalk.agent" :
            case "support.live_person" :            
            case "smalltalk.agent.annoying" :
            case "smalltalk.agent.bad" :
            case "smalltalk.agent.good" :            
              //respondAccordingToTone(senderId, message);
	      sendMessage(senderId, {text:nluData.result.fulfillment.speech});
              break;
            case "ExtractTicketNo":              
              //sendMessage(senderId,{text:"extracting ticket number"});
              getContext(senderId,contexts);
              break;
            case "ConfirmTicket":
              //sendMessage(senderId,{text:"confirming ticket"});
              //sendMessage(senderId,{text:"contexts :"+body});
              getContext(senderId, contexts);
              break;
            default:
              //respondAccordingToTone(senderId,message);
              sendMessage(senderId, {text:nluData.result.fulfillment.speech});
              break;
          }
        }
        //sendMessage(senderId,{text:nluData.result.action});
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
      //sendMessage(senderId,{text:"contexts confirmTicket : "+JSON.stringify(contexts[i].parameters)});
    }
    if(contexts[i].name==='getticketstatus'){
      getStatus=true;
      if(!ticketId) ticketId=contexts[i].parameters.Ticket;
      //sendMessage(senderId,{text:"contexts getTicketStatus : "+JSON.stringify(contexts[i].parameters)});
    }
    if(contexts[i].name==='updateticketstatus'){
      updateStatus=true;
      if(!ticketId)   ticketId=contexts[i].parameters.Ticket;
      toStatusFrmApp=contexts[i].parameters.TicketStatus;
      //sendMessage(senderId,{text:"contexts updateTicketStatus : "+contexts[i].parameters.Ticket + "  "+toStatusFrmApp});
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
        if(ticketStatus == "created"){
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
      //sendMessage(senderId,{text:"Got response : "+body});
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
    //sendMessage(senderId,{text:"You have a ticket in our systems."});
    if(intendingTo==='get'){             
      composeTicketStatus(senderId,ticketsJson[0]);
    }
    else if(intendingTo==='update'){            
      //sendMessage(senderId,{text:"You have a ticket in our systems to update"});
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
    sendMessage(senderId,{text:"You seem to have many tickets created in the system. Below are the last few tickets from you"});
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
    if (error) {
      console.log("Error creating ticket: " + error);
      sendMessage(senderId,{text:"Error creating ticket"});
    }
    else{
      //var ticket = JSON.parse(body);
      var ticketId = body.id;
      //sendMessage(senderId,{text:body});
      
      sendMessage(senderId,{text:"Created Ticket# "+ticketId+". Refer to this ticket for future communication on this issue."});
    }
  });
}


function respondAccordingToTone(senderId,receivedText){
  
  console.log ("came into respondAccordingToTone");
  //sendMessage(senderId, {text: "in getTone"});
  var ToneAnalyzerV3 = require('watson-developer-cloud/tone-analyzer/v3');
 
  var tone_analyzer = new ToneAnalyzerV3({
    username: process.env.WATSON_USERNAME,
    password: process.env.WATSON_PASSWORD,
    version_date: process.env.WATSON_VERSION
  });

  //sendMessage(senderId, {text: "in getTone"+receivedText});
 
  tone_analyzer.tone({ text: receivedText },
    function(err, tone) {
      if (err)
        sendMessage(senderId, {text: "Error Accessing Watson :"+err});
      else{
        //sendMessage(senderId, {text: "Tone Received."});
        var emoTones = tone.document_tone.tone_categories[0].tones;
        //var responded = false;
		    var maxValue = 0;
        for (var i=0; i<emoTones.length;i++){
          if(emoTones[i].score>0.5){
    			  if (!maxValue || parseInt(emoTones[i].score) > parseInt(maxValue.score))
                maxValue = emoTones[i];	              
          }
        }
		
  		//if(!responded) {
  			if (maxValue) {
  				switch(maxValue.tone_id){
  				  case "sadness":
  					updatedText = maxValue.tone_id + ". I'm sorry about how you are feeling about our service.\n"
  					break;
  				  case "fear":
  					updatedText = maxValue.tone_id + ". We are here to help you out to fix your issues. You can have less worry about your issue\n"
  				  case "anger":
  				  case "disgust":
  					updatedText = maxValue.tone_id + ". I'm sorry. I'm still learning. \nOur support team will get in touch with you now.\n We would also like to provide $5 credit to your account which will be adjusted in next bill.";
  					//responded = true;
  					break;
  				  case "joy":
  					updatedText = "Glad you are happy with my service.";
  					//responded = true;
  					break;
  				}
  			} else {
  				updatedText = "";
  			}
  		//}
  		
  		console.log ("Updated Text value is:" + updatedText);
      if (maxValue.tone_id != "anger") {
  		  getNLUforCTA(senderId,receivedText.trim());
      } else {
        sendMessage(senderId, {text:""});
      }
    }
  });
}