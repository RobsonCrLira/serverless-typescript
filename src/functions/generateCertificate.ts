import { APIGatewayProxyHandler } from 'aws-lambda';
import { readFileSync } from 'fs';
import { join } from 'path';
import { compile } from 'handlebars';
import moment from 'moment';
import chromium from 'chrome-aws-lambda';
import { S3 } from 'aws-sdk';
import { document } from '../utils/dynamodbDBClient';

interface ICreateCertificate {
	id: string;
	name: string;
	grade: string;
}

interface ITemplate {
	id: string;
	name: string;
	grade: string;
	medal: string;
	date: string;
}

const compileCertificate = async (data: ITemplate) => {
	const filePath = join(process.cwd(), 'src', 'template', 'certificate.hbs');
	const html = readFileSync(filePath, 'utf-8');
	return compile(html)(data);
};

export const handler: APIGatewayProxyHandler = async (event) => {
	const { id, name, grade } = JSON.parse(event.body) as ICreateCertificate;
	const response = await document
		.query({
			TableName: 'users_certificate',
			KeyConditionExpression: 'id = :id',
			ExpressionAttributeValues: {
				':id': id,
			},
		})
		.promise();

	const userAlreadyExists = response.Items[0];
	if (!userAlreadyExists) {
		await document
			.put({
				TableName: 'users_certificate',
				Item: { id, name, grade },
			})
			.promise();
	}

	const medalPath = join(process.cwd(), 'src', 'template', 'selo.png');
	const medal = readFileSync(medalPath, 'base64');
	const data: ITemplate = {
		id,
		name,
		grade,
		date: moment().format('DD/MM/YYYY HH:mm:ss'),
		medal,
	};

	const content = await compileCertificate(data);

	const browser = await chromium.puppeteer.launch({
		args: chromium.args,
		defaultViewport: chromium.defaultViewport,
		executablePath: await chromium.executablePath,
		userDataDir: './dev/null',
	});

	const page = await browser.newPage();
	await page.setContent(content);
	const pdf = await page.pdf({
		format: 'a4',
		landscape: true,
		printBackground: true,
		preferCSSPageSize: true,
		path: process.env.IS_OFFLINE ? './certificate.pdf' : null,
	});

	await browser.close();

	const s3 = new S3();

	// await s3
	// 	.createBucket({
	// 		Bucket: 'certificate-serverless-node',
	// 	})
	// 	.promise();

	await s3
		.putObject({
			Bucket: 'certificate-serverless-node',
			Key: `${id}.pdf`,
			ACL: 'public-read',
			Body: pdf,
			ContentType: 'application/pdf',
		})
		.promise();
	return {
		statusCode: 201,
		body: JSON.stringify({
			message: 'Certificate Create',
			url: `https://certificate-serverless-node.s3.amazonaws.com/${id}.pdf`,
		}),
	};
};
