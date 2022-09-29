//
//  Lansite Client TextBox
//  By Tanner Krewson
//

BoxNames.push('TextBox');

TextBox.prototype = Object.create(Box.prototype);

function TextBox(data) {
    Box.call(this, data.id, data.unique);
    this.title = data.title;
    this.text = data.text;
}

//@Override
TextBox.prototype.update = function() {
    var thisBox = $('#' + this.unique);

    //set the title
    thisBox.find('.panel-title').html(this.title);
    
    //set the message
    thisBox.find('.message').html(this.text);
}

TextBox.prototype.changeText = function(text) {
    this.text = text;
}

TextBox.addButtons = function(sidebar) {
    sidebar.addButton(new Button('TextBox', 'Envoyer une annonce'));

    //add an event to the submit button of the popup
    var popup = $('#TextBox-Popup');
    var button = $('#TextBox-Popup-submit');
    var self = this;
    button.on('click', function(event) {
        //get the message from the input box
        var message = popup.find('.reqmessage').val();

        //clear the inputs
        popup.find('.reqmessage').val('');
        popup.find('.reqmessage').val('');

        SendToServer.request('postMessage', {
            message: message
        });
    });
}
