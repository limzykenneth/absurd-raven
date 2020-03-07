// You can either provide database information
// Or it can be set in evironment variables with .env or in command line
// Or it will be asked for as input

const inquirer = require("inquirer");
const _ = require("lodash");

const exportMongodb = require("./export/mongodb.js");
const constants = require("./_constants.js");

function exp(program){
	const response = {};
	const questions = [];

	program.command("export")
		.option("-s, --server <server address>", "URL that points to where the database server is (example: mongodb://localhost:27017)")
		.option("-u, --username <username>", "Username of the database server's user, user must have read write access to the database it will be accessing")
		.option("-p, --password <password>", "Password of the database server's user")
		.option("-d, --database <database name>", "Name of the database to use")
		.option("-o, --output <file>", "Path to file to write output to")
		.action(function(cmd){
			if(typeof cmd.server !== "undefined"){
				response.server = cmd.server;
			}else if(process.env.database_host){
				response.server = process.env.database_host;
			}else{
				questions.push({
					type: "input",
					name: "server",
					message: "Server address",
					validate: function(value){
						return value.trim().length > 0 ? true : "Server address cannot be blank";
					}
				});
			}

			if(typeof cmd.username !== "undefined"){
				response.username = cmd.username;
			}else if(process.env.database_username){
				response.username = process.env.database_username;
			}else{
				questions.push({
					type: "input",
					name: "username",
					message: "Username",
					validate: function(value){
						return value.trim().length > 0 ? true : "Username cannot be blank";
					}
				});
			}

			if(typeof cmd.password !== "undefined"){
				response.password = cmd.password;
			}else if(process.env.database_password){
				response.password = process.env.database_password;
			}else{
				questions.push({
					type: "password",
					name: "password",
					message: "Password",
					default: ""
				});
			}

			if(typeof cmd.database !== "undefined"){
				response.database = cmd.database;
			}else if(process.env.database_name){
				response.database = process.env.database_name;
			}else{
				questions.push({
					type: "input",
					name: "database",
					message: "Database",
					validate: function(value){
						return value.trim().length > 0 ? true : "Database name cannot be blank";
					}
				});
			}

			if(typeof cmd.output !== "undefined"){
				response.output = cmd.output;
			}else{
				questions.push({
					type: "input",
					name: "output",
					message: "Output path",
					validate: function(value){
						return value.trim().length > 0 ? true : "Output path cannot be blank";
					}
				});
			}

			// Use Inquirer to ask for missing info
			inquirer.prompt(questions).then((answer) => {
				// Copy answers from inquirer into response object
				_.assign(response, answer);

				// Identify the database type
				const regexResult = constants.databaseRegex.exec(response.server);
				if(regexResult === null){
					throw new Error(`Invalid database server URL: ${response.server}`);
				}else{
					response.databaseType = constants.databaseEnums[regexResult[1]];
					response.serverPath = regexResult[2];
					if(typeof response.databaseType === "undefined"){
						return Promise.reject(new Error(`Database type "${regexResult[1]}" is not supported.`));
					}
				}

				// Export the database
				if(response.databaseType === constants.databaseEnums.mongodb){
					exportMongodb(response);
				}
			}).catch((err) => {
				console.error(err);
			});
		});
}

module.exports = exp;