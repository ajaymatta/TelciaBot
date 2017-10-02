var mongoose = require("mongoose");
var Schema = mongoose.Schema;

var InteractionSchema = new Schema({
  id: {type: String},
  user: {type:String},
  creationDate: {type: Date,default: Date.now},
  resolvedQuery: {type: String},
  action: {type: String},
  contexts: [{
        name: {type: String},
        lifespan: {type: Number}
  }],
  response: {type: String}
});

module.exports = mongoose.model("Interaction", InteractionSchema);
