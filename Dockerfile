FROM python:alpine

EXPOSE 8083

WORKDIR /app

COPY . .

RUN pip install -r requirements.txt

# Start app
CMD ["python", "app.py"]