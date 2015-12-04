/**
 * based on https://github.com/angelozerr/CodeMirror-XQuery/blob/master/codemirror-extension/addon/hint/templates-hint.js
 * and https://github.com/angelozerr/CodeMirror-XQuery/wiki/Completion-with-Templates
 * I prefer the term "snippets"
 */
import CodeMirror = require('codemirror');
interface Marker {
    from: CodeMirror.Position;
    to: CodeMirror.Position
    variable: any; // huh?
    selectable: any; // huh?
}

(function() {
  var templatesMap = [];
  var Pos = CodeMirror.Pos;

  function startsWith(str, token) {
    return str.slice(0, token.length).toUpperCase() == token.toUpperCase();
  }

  CodeMirror.templatesHint = {};

  function getLabel(proposal) {
    var template = proposal.template;
    return document.createTextNode(template.name);
  }

  var ourMap = {
    Tab : selectNextVariable,
    Enter : function(cm) { selectNextVariable(cm, true) },
    Esc : uninstall
  }

  function TemplateState() {
    this.marked = [];
    this.selectableMarkers = [];
    this.varIndex = -1;
  }

  // A Template instance represents an autocompletion template.
  // It can be parsed from an eclipse-type template string,
  // or supplied with a pre-parsed token array.
  //
  // The token array may consist of the following tokens:
  //   "\n" (newline character)
  //       Single newline character per token.
  //   text (string)
  //       Normal text, no newline characters allowed.
  //   { variable: "name" }
  //       Variable token, to be populated by the user.
  //   { cursor: true }
  //       The cursor will be placed here after completing the template
  //   { line_separator: true }
  //       If the template surrounds existing text, the existing text will be
  //       placed here. Not implemented currently.
  function Template(data) {
    this.name = data.name; // Optional
    this.description = data.description; // Optional
    if(data.template != null) {
      this.source = data.template;
    } else if(data.tokens != null) {
      this._tokens = data.tokens;
    }
  }

  Template.prototype.tokens = function() {
    if(this._tokens == null) {
      this._tokens = parseTemplate(this.source);
    }
    return this._tokens;
  };

  Template.prototype.content = function() {
    if(this._content == null) {
      var tokens = this.tokens();
      var content = '';
      for ( var i = 0; i < tokens.length; i++) {
        var token = tokens[i];
        if (typeof token == 'string') {
          content += token;
        } else if (token.variable) {
          content += token.variable;
        } else {
          // Ignore special tokens
        }
      }
      this._content = content;
    }
    return this._content;
  };

  function parseTemplate(content) {
    var tokens = [];
    var varParsing = false;
    var last = null;
    var token = '';
    for ( var i = 0; i < content.length; i++) {
      var current = content.charAt(i);
      if (current == "\n") {
        if (token != '') {
          tokens.push(token);
        }
        token = '';
        tokens.push(current);
        last = null;
      } else {
        var addChar = true;
        if (varParsing) {
          if (current == "}") {
            varParsing = false;
            addChar = false;
            if(token == 'cursor') {
              tokens.push({
                "cursor" : true
              });
            } else if(token == 'line_selection') {
              tokens.push({
                "line_selection" : true
              });
            } else {
              tokens.push({
                "variable" : token
              });
            }
            token = '';
          }
        } else {
          if (current == "$" && (i + 1) <= content.length) {
            i++;
            var next = content.charAt(i);
            if (next == "{") {
              varParsing = true;
              addChar = false;
              if (token != '') {
                tokens.push(token);
              }
              token = '';
            }
          }

        }
        if (addChar && last != "$") {
          token += current;
          last = current;
        } else {
          last = null;
        }
      }
    }
    if (token != '') {
      tokens.push(token);
    }
    return tokens;
  }


  function getMarkerChanged(cm, textChanged) {
    var markers = cm.findMarksAt(textChanged.from);
    if (markers) {
      for ( var i = 0; i < markers.length; i++) {
        var marker = markers[i];
        if (marker._templateVar) {
          return marker;
        }
      }
    }
    return null;
  }

  function onChange(cm, textChanged) {
    var state = cm._templateState;
    if (!textChanged.origin || !state || state.updating) {
      return;
    }
    try {
      state.updating = true;
      var markerChanged = getMarkerChanged(cm, textChanged);
      if (markerChanged == null) {
        uninstall(cm);
      } else {
        var posChanged = markerChanged.find();
        var newContent = cm.getRange(posChanged.from, posChanged.to);
        for ( var i = 0; i < state.marked.length; i++) {
          var marker = state.marked[i];
          if (marker != markerChanged
              && marker._templateVar == markerChanged._templateVar) {
            var pos = marker.find();
            cm.replaceRange(newContent, pos.from, pos.to);
          }
        }
      }
    } finally {
      state.updating = false;
    }
  }

  function selectNextVariable(cm, exitOnEnd) {
    var state = cm._templateState;
    if (state.selectableMarkers.length > 0) {
      state.varIndex++;
      if (state.varIndex >= state.selectableMarkers.length) {
        // If we reach the last token and exitOnEnd is true, we exit instead of
        // looping back to the first token.
        if (exitOnEnd) {
          exit(cm);
          return;
        }
        state.varIndex = 0;
      }
      var marker = state.selectableMarkers[state.varIndex];
      var pos = marker.find();
      cm.setSelection(pos.from, pos.to);
      var templateVar = marker._templateVar;
      for ( var i = 0; i < state.marked.length; i++) {
        var m = state.marked[i];
        if (m == marker) {
          m.className = "";
          m.startStyle = "";
          m.endStyle = "";
        } else {
          if (m._templateVar == marker._templateVar) {
            m.className = "CodeMirror-templates-variable-selected";
            m.startStyle = "";
            m.endStyle = "";
          } else {
            m.className = "CodeMirror-templates-variable";
            m.startStyle = "CodeMirror-templates-variable-start";
            m.endStyle = "CodeMirror-templates-variable-end";
          }
        }
      }
      cm.refresh();
    } else {
      // No tokens - exit.
      exit(cm);
    }
  }

  Template.prototype.insert = function(cm, data:Marker) {
    if (cm._templateState) {
      uninstall(cm);
    }
    var state = new TemplateState();
    cm._templateState = state;

    var tokens = this.tokens();
    var content = '';
    var line = data.from.line;
    var col = data.from.ch;
    var markers:Marker[] = [];
    var variables = [];
    var cursor = null;
    for ( var i = 0; i < tokens.length; i++) {
      var token = tokens[i];
      if(typeof token == 'string') {
        content += token;
        if (token == "\n") {
          line++;
          col = 0;
        } else {
          col += token.length;
        }
      } else if (token.variable) {
        content += token.variable;
        var from = Pos(line, col);
        var to = Pos(line, col
            + token.variable.length);
        var selectable = variables[token.variable] != false;
        col += token.variable.length;
        markers.push({
          from : from,
          to : to,
          variable : token.variable,
          selectable : selectable
        });
        variables[token.variable] = false;
      } else if(token.cursor) {
        cursor = Pos(line, col);
      } else {
        // Unhandled tokens, e.g. line_selection. Ignore.
      }
    }

    var from = data.from;
    var to = data.to;
    var startLine = from.line;
    cm.replaceRange(content, from, to);

    for ( var i = 0; i < markers.length; i++) {
      var marker = markers[i], from = marker.from, to = marker.to;
      var markText = cm.markText(from, to, {
        className : "CodeMirror-templates-variable",
        startStyle : "CodeMirror-templates-variable-start",
        endStyle : "CodeMirror-templates-variable-end",
        inclusiveLeft : true,
        inclusiveRight : true,
        clearWhenEmpty: false,  // Works in CodeMirror 4.6
        _templateVar : marker.variable
      });
      state.marked.push(markText);
      if (marker.selectable == true) {
        state.selectableMarkers.push(markText);
      }
    }

    if (cursor != null) {
      state.cursor = cm.setBookmark(cursor);
    }

    // Auto-indent everything except the first line.
    // This will typically indent the rest of the code according
    // to the indentation of the first line.
    // We do the indentation after creating the markers, so that the
    // markers are moved accordingly.
    var lines = content.split("\n");
    for ( var x = 1; x < lines.length; x++) {
      var targetLine = startLine + x;
      cm.indentLine(targetLine);
    }

    // Have to be before selectNextVariable, since selectNextVariable
    // may exit and remove the keymap again.
    cm.on("change", onChange);
    cm.addKeyMap(ourMap);

    selectNextVariable(cm, true);
  }

  function exit(cm) {
    // Move to ${cursor} in the template, then uninstall.
    var cursor = cm._templateState.cursor;
    if (cursor != null) {
      var cursorPos = cursor.find();
      if (cursorPos != null) {
        cm.setSelection(cursorPos, cursorPos);
      }
    }
    uninstall(cm);
  }

  function uninstall(cm) {
    var state = cm._templateState;
    for ( var i = 0; i < state.marked.length; i++) {
      state.marked[i].clear();
    }
    if (state.cursor != null) {
      state.cursor.clear();
    }
    state.marked.length = 0;
    state.selectableMarkers.length = 0;
    cm.off("change", onChange);
    cm.removeKeyMap(ourMap);
    delete cm._templateState;
  }

  CodeMirror.templatesHint.getCompletions = function(cm:CodeMirror.EditorFromTextArea, completions:CodeMirror.Hint[], text) {
    var mode = cm.getDoc().getMode().name;
    var list = templatesMap[mode];
    if (list) {
      for ( var i = 0; i < list.length; i++) {
        var template = list[i];
        if (startsWith(template.name, text)) {
          var label = template.name;
          if (template.description) {
            label += '- ' + template.description;
          }
          var className = "CodeMirror-hint-template";
          if (template.className)
            className = template.className;
          var completion:CodeMirror.Hint = {
            "className" : className,
            "text" : label,
            "template" : template
          };
          completion.data = completion;
          completion.hint = function(cm, data, completion) {
            completion.template.insert(cm, data);
          };
          completion.info = function(completion) {
            var content = completion.template.content();

            // BAS: disabled runmode as it will not work with our TypeScript mode anyways :)
            // if (CodeMirror.runMode) {
            //   var result = document.createElement('div');
            //   result.className = 'cm-s-default';
            //   if (cm.options && cm.options.theme)
            //     result.className = 'cm-s-' + cm.options.theme;
            //   CodeMirror.runMode(content, cm.getMode().name, result);
            //   return result;
            // }

            return content;
          };
          completions.push(completion);
        }
      }
    }
  }

  CodeMirror.templatesHint.Template = Template;

  CodeMirror.templatesHint.addTemplates = function(templates) {
    var context = templates.context;
    if (context) {
      var list = templatesMap[context];
      if (!list) {
        list = [];
        templatesMap[context] = list;
      }
      templates.templates.forEach(function(template) {
        list.push(new Template(template));
      });
    }
  }

})();


/** Based on https://github.com/angelozerr/CodeMirror-XQuery/blob/master/codemirror-javascript/addon/hint/javascript/javascript-templates.js#L1 */
(function() {
    var templates = {
        "name": "javascript", "context": "javascript", "templates": [
            { "name": "for", "description": "iterate over array", "template": "for (var ${index} = 0; ${index} < ${array}.length; ${index}++) {\n\t${line_selection}${cursor}\n}" },
            { "name": "for", "description": "iterate over array with temporary variable", "template": "for (var ${index} = 0; ${index} < ${array}.length; ${index}++) {\n\tvar ${array_element} = ${array}[${index}];\n\t${cursor}\n}" },
            { "name": "forin", "description": "iterate using for .. in", "template": "for (var ${iterable_element} in ${iterable}) {\n\t${cursor}\n}" },
            { "name": "do", "description": "do while statement", "template": "do {\n\t${line_selection}${cursor}\n} while (${condition});" },
            { "name": "switch", "description": "switch case statement", "template": "switch (${key}) {\n\tcase ${value}:\n\t\t${cursor}\n\t\tbreak;\n\n\tdefault:\n\t\tbreak;\n}" },
            { "name": "if", "description": "if statement", "template": "if (${condition}) {\n\t${line_selection}${cursor}\n}" },
            { "name": "ifelse", "description": "if else statement", "template": "if (${condition}) {\n\t${cursor}\n} else {\n\t\n}" },
            { "name": "elseif", "description": "else if block", "template": "else if (${condition}) {\n\t${cursor}\n}" },
            { "name": "else", "description": "else block", "template": "else {\n\t${cursor}\n}" },
            { "name": "try", "description": "try catch block", "template": "try {\n\t${line_selection}${cursor}\n} catch (e) {\n\t// ${todo}: handle exception\n}" },
            { "name": "catch", "description": "catch block", "template": "catch (e) {\n\t${cursor}// ${todo}: handle exception\n}" },
            { "name": "function", "description": "function", "template": "function ${name}(${}) {\n\t${cursor}\n}" },
            { "name": "function", "description": "anonymous function", "template": "function (${}) {\n\t${cursor}\n}" },
            { "name": "new", "description": "create new object", "template": "var ${name} = new ${type}(${arguments});" },
            { "name": "lazy", "description": "lazy creation", "template": "if (${name:var} == null) {\n\t${name} = new ${type}(${arguments});\n\t${cursor}\n}\n\nreturn ${name};" },
            { "name": "<code>", "description": "<code></code>", "template": "<code>${word_selection}${}</code>${cursor}" },
            { "name": "null", "description": "<code>null</code>", "template": "<code>null</code>" },
            { "name": "true", "description": "<code>true</code>", "template": "<code>true</code>" },
            { "name": "false", "description": "<code>false</code>", "template": "<code>false</code>" },
            { "name": "<pre>", "description": "<pre></pre>", "template": "<pre>${word_selection}${}</pre>${cursor}" },
            { "name": "<b>", "description": "<b></b>", "template": "<b>${word_selection}${}</b>${cursor}" },
            { "name": "<i>", "description": "<i></i>", "template": "<i>${word_selection}${}</i>${cursor}" },
            { "name": "@author", "description": "author name", "template": "@author ${user}" },
            { "name": "while", "description": "while loop with condition", "template": "while (${condition}) {\n\t${line_selection}${cursor}\n}" }
        ]
    };
    CodeMirror.templatesHint.addTemplates(templates);
})();
