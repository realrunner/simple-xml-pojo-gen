
(function(window) {

    var reservedWords = {"default":true, "class":true, "public":true, "static":true, "void":true};

    var BeanGenerator = function(xml) {
        this.xml = xml;
        this.classes = {};
    };

    BeanGenerator.prototype.generate = function () {

        var doc = parse(this.xml);
        this.rootTagName = stripNS(doc.firstChild.tagName);
        this.visitClass(doc.firstChild, null);
        return this.generateClassText(this.classes[this.rootTagName]);

    };

    BeanGenerator.prototype.visitClass = function (node) {
        var $this = this;
        var name = stripNS(node.tagName);
        if(!this.classes[name]) {
            this.classes[name] = {name:name, fields:{}};
        }
        var cls = this.classes[name];

        var grouped = _.groupBy(node.children, 'tagName');
        _.each(grouped, function(nodes, key) {
            key = stripNS(key);
            if(!cls.fields[key]) {
                cls.fields[key] = {name:key, isInlineList:false, isList:false, isAttribute:false};
            }
            var field = cls.fields[key];
            if(nodes.length > 1) {
                field.isInlineList = true;
            }

            _.each(nodes, function(node) {
                if(isClass(node)) {
                    field.dataType = key;
                    var nested = $this.visitClass(node);
                    // this field is a list of classes
                    if(_.size(nested.fields) == 1 && _.values(nested.fields)[0].isInlineList) {
                        delete $this.classes[nested.name];
                        var nestedField = _.values(nested.fields)[0];
                        field.dataType = nestedField.dataType;
                        field.isList = true;
                    }
                }
                else {
                    field.dataType = getLiteralDataType(node.textContent);
                }
            });
        });

        _.each(node.attributes, function(attrib) {
            var key = attrib.name;
            if(_.contains(key, "xmlns:") || key == "xmlns") return;
            key = stripNS(key);
            if(!cls.fields[key]) {
                cls.fields[key] = {name:key, isInlineList:false, isAttribute:true};
            }
            var field = cls.fields[key];
            field.dataType = getLiteralDataType(attrib.value);
        });

        return cls;
    };

    BeanGenerator.prototype.generateClassText = function(cls, indent) {
        var i, headers, fields, accessors, inners, $this = this, isStatic="", root="";

        indent = indent || 0;

        i = _.map(_.range(indent), function() { return " "; } ).join("");

        if(cls.name == this.rootTagName) {
            inners = _.map(this.classes, function(clazz, name) {
                if(name == cls.name) return "";
                return $this.generateClassText(clazz, 4);
            }).join("\n\n");

            headers = "\nimport org.simpleframework.xml.Attribute;\n" +
                "import org.simpleframework.xml.Element;\n"+
                "import org.simpleframework.xml.ElementList;\n"+
                "import org.simpleframework.xml.Root;\n\n"+
                "import java.math.BigDecimal;\n"+
                "import java.util.List;\n\n";

            root = i+"@Root(name = \""+cls.name+"\")\n";
        }
        else {
            isStatic = "static ";
        }

        fields = this.generateFieldText(cls.fields, indent);
        accessors = this.generateAccessors(cls.fields, indent);

        return _.template(
            "<%-headers%>" +
            "<%=root%>" +
            i+"public <%-static%>class <%-className%> {\n" +
            "\n" +
            "<%=fields%>\n" +
            "\n\n" +
            "<%=accessors%>\n" +
            "<%=inners%>\n" +
            i+"}")({
            tagName:cls.name,
            className: mkClassName(cls.name),
            fields:fields,
            accessors:accessors,
            inners:inners,
            headers:headers,
            static:isStatic,
            root:root
        });
    };

    BeanGenerator.prototype.generateFieldText = function(fields, indent) {
        var $this = this;
        indent = (indent || 0)+4;
        var i = _.map(_.range(indent), function() { return " "; } ).join("");

        return _.map(fields, function(field) {
            var isClass = !!$this.classes[field.dataType];
            var dataType = isClass ? mkClassName(field.dataType) : field.dataType;
            var annotation = field.isAttribute ? "@Attribute(name=\""+field.name+"\")" : "@Element(name=\""+field.name+"\")";
            if(field.isList || field.isInlineList) {
                dataType = "List<" + dataType + ">";
                var inline = field.isInlineList ? ", inline = true" : "";
                annotation = "@ElementList(name = \""+field.name+"\""+inline+")";
            }
            var fieldName = mkFieldName(field.name);

            return i + annotation + "\n" +
                   i + dataType + " " + fieldName + ";\n";
        }).join("\n\n");
    };

    BeanGenerator.prototype.generateAccessors = function(fields, indent) {
        var $this = this;
        indent = (indent || 0)+4;
        var i = _.map(_.range(indent), function() { return " "; } ).join("");
        var i2 =_.map(_.range(indent+4), function() { return " "; } ).join("");

        return _.map(fields, function(field) {
            var isClass = !!$this.classes[field.dataType];
            var dataType = isClass ? mkClassName(field.dataType) : field.dataType;
            if(field.isList|| field.isInlineList) {
                dataType = "List<" + dataType + ">";
            }
            var fieldName = mkFieldName(field.name);
            return i + "public " + dataType + " get" + cap(field.name) + "() { return this." + fieldName + "; }\n" +
                   i + "public void set" + cap(field.name) + "(" + dataType + " _value) { this." + fieldName + " = _value; }\n";
        }).join("\n\n");
    };

    function mkClassName(str) {
        return reservedCheck(cap(str));
    }

    function cap(str) {
        return str.charAt(0).toUpperCase() + str.substring(1);
    }

    function mkFieldName(str) {
        return reservedCheck(str.charAt(0).toLowerCase() + str.substring(1));
    }

    function stripNS(str) {
        if(_.contains(str,":")) {
            return str.substring(str.indexOf(":")+1);
        }
        return str;
    }

    function reservedCheck(str) {
        if(reservedWords[str]) {
            return "_" + str;
        }
        return str;
    }

    function getLiteralDataType(val) {
        if(val == "true" || val == "false") {
            return "Boolean";
        }
        else if(_.isNumber(val)) {
            if(_.contains(val,'.')) {
                return "Double"
            }
            else {
                return "Integer"
            }
        }
        return "String";
    }

    function isClass(node) {
        return node.children.length > 0 ||
            node.attributes.length > 0;
    }

    function parse(xml) {
        if (window.DOMParser) {
            var parser = new DOMParser();
            return parser.parseFromString(xml, "text/xml");
        }
        else // Internet Explorer
        {
            var xmlDoc = new ActiveXObject("Microsoft.XMLDOM");
            xmlDoc.async = false;
            xmlDoc.loadXML(xml);
            return xmlDoc;
        }
    }


    //exports
    window.BeanGenerator = BeanGenerator;

})(window);