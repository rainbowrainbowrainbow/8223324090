'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const PINNED = require('../config/checkboxOpenApiContract');
const { validateOfficialOpenApi } = require('../scripts/check-checkbox-openapi-compatibility');

function schemaRef(name) {
    return { $ref: `#/components/schemas/${name}` };
}

function propertyFixture(expected) {
    const property = {};
    if (expected.type) property.type = expected.type;
    if (expected.format) property.format = expected.format;
    if (expected.ref) property.$ref = schemaRef(expected.ref).$ref;
    if (expected.itemRef) property.items = schemaRef(expected.itemRef);
    if (expected.enum) property.enum = [...expected.enum];
    if (expected.anyArrayItemTypes) {
        property.anyOf = expected.anyArrayItemTypes.map(type => ({
            type: 'array',
            maxItems: PINNED.units.maximumTaxIdsPerGood,
            items: { type }
        }));
    }
    return property;
}

function buildOfficialShapedFixture() {
    const fixture = {
        openapi: '3.1.0',
        info: { version: PINNED.observedVersion },
        paths: {},
        components: { schemas: {} }
    };

    for (const operationContract of PINNED.operations) {
        const pathItem = fixture.paths[operationContract.path] ||= {};
        const operation = {
            parameters: (operationContract.requiredHeaders || []).map(name => ({ name, in: 'header', required: true })),
            responses: Object.fromEntries(operationContract.responses.map(code => [code, { description: code }]))
        };
        if (operationContract.requestSchema) {
            operation.requestBody = { content: { 'application/json': { schema: schemaRef(operationContract.requestSchema) } } };
        }
        const success = operationContract.responses.find(code => /^2\d\d$/.test(code));
        let successSchema = null;
        if (operationContract.successSchema) successSchema = schemaRef(operationContract.successSchema);
        if (operationContract.successArrayItemSchema) successSchema = { type: 'array', items: schemaRef(operationContract.successArrayItemSchema) };
        if (operationContract.successAdditionalPropertiesType) {
            successSchema = { type: 'object', additionalProperties: { type: operationContract.successAdditionalPropertiesType } };
        }
        if (successSchema) operation.responses[success].content = { 'application/json': { schema: successSchema } };
        pathItem[operationContract.method] = operation;
    }

    for (const [name, contract] of Object.entries(PINNED.schemas)) {
        fixture.components.schemas[name] = {
            type: 'object',
            required: [...(contract.required || [])],
            properties: Object.fromEntries(
                Object.entries(contract.properties || {}).map(([propertyName, expected]) => [propertyName, propertyFixture(expected)])
            )
        };
    }
    for (const [name, values] of Object.entries(PINNED.enums)) {
        fixture.components.schemas[name] = { type: 'string', enum: [...values] };
    }

    fixture.components.schemas.GoodItemPayload.properties.quantity.title = '1 unit = 1000';
    fixture.components.schemas.GoodDetailsPayload.properties.price.title = 'Minor units per quantity = 1000';
    return fixture;
}

test('value-free pinned Checkbox projection accepts an official-shaped semantic contract', () => {
    assert.deepEqual(validateOfficialOpenApi(buildOfficialShapedFixture()), []);
});

test('semantic OpenAPI gate rejects response-code and required-field drift', () => {
    const fixture = buildOfficialShapedFixture();
    delete fixture.paths['/api/v1/shifts'].post.responses['202'];
    fixture.paths['/api/v1/shifts'].post.responses['201'] = { description: 'unexpected' };
    fixture.components.schemas.CashRegisterDeviceModel.required = fixture.components.schemas.CashRegisterDeviceModel.required.filter(field => field !== 'has_shift');

    const errors = validateOfficialOpenApi(fixture);
    assert.ok(errors.some(message => message.includes('POST /api/v1/shifts response codes drifted')));
    assert.ok(errors.some(message => message.includes('CashRegisterDeviceModel.required drifted')));
});
