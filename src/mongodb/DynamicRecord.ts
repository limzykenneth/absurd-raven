import * as _ from "lodash";
import {Model as ModelBase} from "../DynamicRecord";
import DynamicCollection from "./DynamicCollection";
import DynamicSchema from "./DynamicSchema";

// Let's get mongodb working first
import connect from "./connection";
const schemaValidator = new (require("./schemaValidation.js"))(connect);

class DynamicRecord {
	// Static constructors for their own separate use
	static DynamicSchema = DynamicSchema(connect);
	static DynamicCollection = DynamicCollection;

	private _databaseConnection: any;
	private _ready: any;
	private _db: any;
	private _client: any;

	// Instance specific constructors
	Model: any;
	// Instance specific Schema object
	schema: any;

	/**
	 * Creates a new DynamicRecord instance.
	 *
	 * @name DynamicRecord
	 * @class
	 * @param {object} options
	 * @param {string} options.tableSlug - The slug of the table. Must be lowercase only
	 * and not containing any whitespace
	 */
	constructor(options){
		this._databaseConnection = connect;
		const _schema = this.schema = new (DynamicSchema(this._databaseConnection))();
		const tableSlug = options.tableSlug;
		let _db;
		let _client;

		// Initialize database connection and populate schema instance
		const _ready = this._ready = connect.then((opts) => {
			const db = _db = this._db = opts.db;
			_client = this._client = opts.client;

			// Collection must already exist in database
			return this.schema.read(tableSlug).then((schema) => {
				if(schema.tableSlug === "") return Promise.reject(`Table with name ${tableSlug} does not exist`);

				const col = db.collection(tableSlug);

				if(col){
					return Promise.resolve(col);
				}else{
					return Promise.reject(`Table with name ${tableSlug} does not exist`);
				}
			});
		});

		const Model = this.Model = class Model extends ModelBase{
			constructor(data, _preserveOriginal){
				super(data, _preserveOriginal);
			}

			async save(){
				const col = await _ready;
				if(this._original){
					await validateData(this.data);
					await col.updateOne(this._original, {$set: this.data}, {upsert: true});
					this._original = _.cloneDeep(this.data);
					return this;
				}else{
					// Check if collection contains index that needs auto incrementing
					return _db.collection("_counters").findOne({_$id: tableSlug}).then(async (res) => {
						const promises = [];
						if(res !== null){
							// Auto incrementing index exist
							_.each(res.sequences, (el, columnLabel) => {
								promises.push(_schema._incrementCounter(tableSlug, columnLabel).then((newSequence) => {
									this.data[columnLabel] = newSequence;
									return Promise.resolve(newSequence);
								}));
							});

							await Promise.all(promises);
						}
						await validateData(this.data);

						// Save data into the database
						await col.insertOne(this.data);
						this._original = _.cloneDeep(this.data);
						return this;
					}).catch(async (err) => {
						// Reverse database actions
						try{
							await Promise.all([
								// 1. Decrement autoincrement counter
								_db.collection("_counters").findOne({_$id: tableSlug}).then((res) => {
									const promises = [];
									_.each(res.sequences, (el, columnLabel) => {
										promises.push(_schema._decrementCounter(tableSlug, columnLabel));
									});

									return Promise.all(promises);
								})
							]);
							return Promise.reject(err);
						} catch(e) {
							return Promise.reject(e);
						}
					});
				}

				async function validateData(data){
					const validate = await schemaValidator.compileAsync({$ref: _schema.tableSlug});
					if(validate(data)){
						return Promise.resolve();
					}else{
						return Promise.reject(new Error(validate.errors));
					}
				}
			}

			async destroy(){
				const col = await _ready;

				if(this._original){
					await col.deleteOne(this._original);
					this._original = null;
					this.data = null;
					return this;
				}else{
					throw new Error("Model not saved in database yet.");
				}
			}

			validate(schema){
				let result = false;

				_.each(this.data, (el, key) => {
					const field = _.find(schema, (column) => {
						return column.label == key;
					});

					if(field.type == "string"){
						result = _.isString(el);
					}else if(field.type == "int"){
						result = Number.isInteger(el);
					}
				});

				return result;
			}
		};
	}

	/**
	 * Close the connection to the database server. Only used to terminate
	 * the running node instance.
	 *
	 * @method closeConnection
	 * @memberOf DynamicRecord
	 * @instance
	 */
	async closeConnection(){
		// Should only ever be called to terminate the node process
		try{
			await this._ready;
			this._client.close();
		} catch(e) {
			// BY ANY MEANS NECESSARY
			this._client.close();
		}
	}

	/**
	 * Find the latest entry in the table that match the query.
	 *
	 * @method findBy
	 * @memberOf DynamicRecord
	 * @instance
	 * @param {object} query - A key value pair that will be used to match for entry
	 * in the database
	 * @return {Promise} Return promise of DynamicRecord.Model instance or null
	 */
	async findBy(query: object){
		// CONSIDER: Possibly implement our own unique id system
		const col = await this._ready;
		const model = await col.findOne(query);

		if(model !== null){
			// Delete mongodb added "_id" field
			delete model._id;
			return new this.Model(model, true);
		}else{
			return null;
		}
	}

	/**
	 * Find all the entries in the table that match the query.
	 *
	 * You can sort the returned data by providing a string key to sort the
	 * data by or a sorting function to manually sort the data. By default
	 * they are sorted in the order they are in in the database.
	 *
	 * @method where
	 * @memberOf DynamicRecord
	 * @instance
	 * @param {object} query - A key value pair that will be used to match for entries
	 * @param {string|function} orderBy - The key to sort by or a sorting function
	 * @return {Promise} Return promise of DynamicCollection instance
	 */
	async where(query: object, orderBy: string | Function){
		const col = await this._ready;
		let models = await col.find(query).toArray();

		if(orderBy){
			models = _.sortBy(models, orderBy);
		}

		// Delete mongodb added "_id" field
		models.forEach((el) => {
			delete el._id;
		});

		const results = new DynamicCollection(this.Model, ...models);

		results.forEach((result) => {
			result._original = _.cloneDeep(result.data);
		});

		return results;
	}

	/**
	 * Return all entries from the table.
	 *
	 * @method all
	 * @memberOf DynamicRecord
	 * @instance
	 * @return {Promise} Return promise of DynamicCollection instance
	 */
	async all(){
		const col = await this._ready;
		let models = await col.find().toArray();
		// Delete mongodb added "_id" field
		models.forEach((el) => {
			delete el._id;
		});

		const results = new DynamicCollection(this.Model, ...models);

		results.forEach((result) => {
			result._original = _.cloneDeep(result.data);
		});

		return results;
	}

	/**
	 * Return the first entry in the table. If provided with an integer
	 * argument n, it will return the first nth entry in the database wrapped
	 * in a Promise of DynamicCollection.
	 *
	 * @method first
	 * @memberOf DynamicRecord
	 * @instance
	 * @param {number} [n] - The number of records to return
	 * @return {Promise} Return promise of DynamicRecord.Model instance,
	 * DynamicCollection instance, or null
	 */
	async first(n?:number){
		const col = await this._ready;
		if(typeof n === "undefined"){
			const model = await col.findOne();
			if(model !== null){
				// Delete mongodb added "_id" field
				delete model._id;
				return new this.Model(model, true);
			}else{
				return null;
			}
		}else{
			const models = await col.find({}).limit(n).toArray();
			// Delete mongodb added "_id" field
			models.forEach((el) => {
				delete el._id;
			});

			return new DynamicCollection(this.Model, ...models);
		}
	}
}

module.exports = DynamicRecord;